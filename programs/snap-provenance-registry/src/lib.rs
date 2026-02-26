use anchor_lang::prelude::*;

declare_id!("8o2oGKLyLfFcJziNXNthPs4QCMhLgN9vqmMEZZRnefee");

const MAX_TRUSTED_SIGNERS: usize = 64;
const MAX_METADATA_URI_LEN: usize = 160;

#[program]
pub mod snap_provenance_registry {
    use super::*;

    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let registry = &mut ctx.accounts.registry;
        registry.admin = ctx.accounts.admin.key();
        registry.paused = false;
        registry.bump = ctx.bumps.registry;
        registry.reserved = [0u8; 6];
        registry.trusted_signers = Vec::new();
        registry.created_at = now;
        registry.updated_at = now;
        emit!(RegistryInitialized {
            registry: registry.key(),
            admin: registry.admin,
        });
        Ok(())
    }

    pub fn set_registry_admin(ctx: Context<UpdateRegistry>, new_admin: Pubkey) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.admin = new_admin;
        registry.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn set_registry_pause(ctx: Context<UpdateRegistry>, paused: bool) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.paused = paused;
        registry.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn set_trusted_signer(
        ctx: Context<UpdateRegistry>,
        signer: Pubkey,
        enabled: bool,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        if enabled {
            if !registry.trusted_signers.iter().any(|pk| *pk == signer) {
                require!(
                    registry.trusted_signers.len() < MAX_TRUSTED_SIGNERS,
                    ProvenanceRegistryError::TrustedSignerListFull
                );
                registry.trusted_signers.push(signer);
            }
        } else {
            registry.trusted_signers.retain(|pk| *pk != signer);
        }
        registry.updated_at = Clock::get()?.unix_timestamp;
        emit!(TrustedSignerUpdated {
            registry: registry.key(),
            signer,
            enabled,
        });
        Ok(())
    }

    pub fn record_match_provenance(
        ctx: Context<RecordMatchProvenance>,
        input: MatchProvenanceInput,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        require!(!registry.paused, ProvenanceRegistryError::RegistryPaused);
        require!(
            input.metadata_uri.as_bytes().len() <= MAX_METADATA_URI_LEN,
            ProvenanceRegistryError::MetadataUriTooLong
        );

        let reporter = ctx.accounts.reporter.key();
        let player = ctx.accounts.player.key();
        let is_trusted = registry.trusted_signers.iter().any(|pk| *pk == reporter);
        require!(
            reporter == player || is_trusted,
            ProvenanceRegistryError::UnauthorizedReporter
        );

        let now = Clock::get()?.unix_timestamp;
        let player_cv = &mut ctx.accounts.player_cv;
        let player_game_cv = &mut ctx.accounts.player_game_cv;
        let match_provenance = &mut ctx.accounts.match_provenance;

        initialize_player_cv_if_needed(player_cv, registry.key(), player, ctx.bumps.player_cv, now);
        initialize_player_game_cv_if_needed(
            player_game_cv,
            registry.key(),
            player,
            input.game_id,
            ctx.bumps.player_game_cv,
            now,
        );

        increment_cv(player_cv, &input)?;
        increment_game_cv(player_game_cv, &input)?;

        match_provenance.registry = registry.key();
        match_provenance.player = player;
        match_provenance.game_id = input.game_id;
        match_provenance.match_id = input.match_id;
        match_provenance.reporter = reporter;
        match_provenance.final_state_hash = input.final_state_hash;
        match_provenance.log_hash = input.log_hash;
        match_provenance.provenance_hash = input.provenance_hash;
        match_provenance.kills = input.kills;
        match_provenance.deaths = input.deaths;
        match_provenance.assists = input.assists;
        match_provenance.score = input.score;
        match_provenance.won = input.won;
        match_provenance.bump = ctx.bumps.match_provenance;
        match_provenance.reserved = [0u8; 6];
        match_provenance.recorded_at = now;
        match_provenance.metadata_uri = input.metadata_uri;

        registry.updated_at = now;

        emit!(MatchProvenanceRecorded {
            registry: registry.key(),
            player,
            game_id: input.game_id,
            match_id: input.match_id,
            reporter,
            won: input.won,
            kills: input.kills,
            deaths: input.deaths,
            assists: input.assists,
            score: input.score,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + ProvenanceRegistry::INIT_SPACE,
        seeds = [b"registry"],
        bump
    )]
    pub registry: Account<'info, ProvenanceRegistry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateRegistry<'info> {
    #[account(
        mut,
        seeds = [b"registry"],
        bump = registry.bump,
        has_one = admin @ ProvenanceRegistryError::UnauthorizedAdmin
    )]
    pub registry: Account<'info, ProvenanceRegistry>,
    pub admin: Signer<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MatchProvenanceInput {
    pub game_id: [u8; 32],
    pub match_id: [u8; 32],
    pub final_state_hash: [u8; 32],
    pub log_hash: [u8; 32],
    pub provenance_hash: [u8; 32],
    pub kills: u32,
    pub deaths: u32,
    pub assists: u32,
    pub score: u32,
    pub won: bool,
    pub metadata_uri: String,
}

#[derive(Accounts)]
#[instruction(input: MatchProvenanceInput)]
pub struct RecordMatchProvenance<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,
    /// CHECK: wallet identity only; PDA seeds bind this key into CV accounts.
    pub player: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"registry"],
        bump = registry.bump
    )]
    pub registry: Account<'info, ProvenanceRegistry>,
    #[account(
        init_if_needed,
        payer = reporter,
        space = 8 + PlayerCv::INIT_SPACE,
        seeds = [b"player_cv", registry.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_cv: Account<'info, PlayerCv>,
    #[account(
        init_if_needed,
        payer = reporter,
        space = 8 + PlayerGameCv::INIT_SPACE,
        seeds = [
            b"player_game_cv",
            registry.key().as_ref(),
            player.key().as_ref(),
            input.game_id.as_ref(),
        ],
        bump
    )]
    pub player_game_cv: Account<'info, PlayerGameCv>,
    #[account(
        init,
        payer = reporter,
        space = 8 + MatchProvenance::INIT_SPACE,
        seeds = [
            b"match_provenance",
            registry.key().as_ref(),
            player.key().as_ref(),
            input.game_id.as_ref(),
            input.match_id.as_ref(),
        ],
        bump
    )]
    pub match_provenance: Account<'info, MatchProvenance>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct ProvenanceRegistry {
    pub admin: Pubkey,
    pub paused: bool,
    pub bump: u8,
    pub reserved: [u8; 6],
    #[max_len(MAX_TRUSTED_SIGNERS)]
    pub trusted_signers: Vec<Pubkey>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct PlayerCv {
    pub registry: Pubkey,
    pub player: Pubkey,
    pub games_played: u64,
    pub wins: u64,
    pub kills: u64,
    pub deaths: u64,
    pub assists: u64,
    pub score: u64,
    pub matches_recorded: u64,
    pub last_match_at: i64,
    pub bump: u8,
    pub reserved: [u8; 7],
    pub created_at: i64,
    pub updated_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct PlayerGameCv {
    pub registry: Pubkey,
    pub player: Pubkey,
    pub game_id: [u8; 32],
    pub games_played: u64,
    pub wins: u64,
    pub kills: u64,
    pub deaths: u64,
    pub assists: u64,
    pub score: u64,
    pub matches_recorded: u64,
    pub last_match_at: i64,
    pub bump: u8,
    pub reserved: [u8; 7],
    pub created_at: i64,
    pub updated_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct MatchProvenance {
    pub registry: Pubkey,
    pub player: Pubkey,
    pub game_id: [u8; 32],
    pub match_id: [u8; 32],
    pub reporter: Pubkey,
    pub final_state_hash: [u8; 32],
    pub log_hash: [u8; 32],
    pub provenance_hash: [u8; 32],
    pub kills: u32,
    pub deaths: u32,
    pub assists: u32,
    pub score: u32,
    pub won: bool,
    pub bump: u8,
    pub reserved: [u8; 6],
    pub recorded_at: i64,
    #[max_len(MAX_METADATA_URI_LEN)]
    pub metadata_uri: String,
}

#[event]
pub struct RegistryInitialized {
    pub registry: Pubkey,
    pub admin: Pubkey,
}

#[event]
pub struct TrustedSignerUpdated {
    pub registry: Pubkey,
    pub signer: Pubkey,
    pub enabled: bool,
}

#[event]
pub struct MatchProvenanceRecorded {
    pub registry: Pubkey,
    pub player: Pubkey,
    pub game_id: [u8; 32],
    pub match_id: [u8; 32],
    pub reporter: Pubkey,
    pub won: bool,
    pub kills: u32,
    pub deaths: u32,
    pub assists: u32,
    pub score: u32,
}

fn initialize_player_cv_if_needed(
    player_cv: &mut Account<PlayerCv>,
    registry: Pubkey,
    player: Pubkey,
    bump: u8,
    now: i64,
) {
    if player_cv.created_at == 0 {
        player_cv.created_at = now;
        player_cv.bump = bump;
        player_cv.reserved = [0u8; 7];
    }
    player_cv.registry = registry;
    player_cv.player = player;
}

fn initialize_player_game_cv_if_needed(
    player_game_cv: &mut Account<PlayerGameCv>,
    registry: Pubkey,
    player: Pubkey,
    game_id: [u8; 32],
    bump: u8,
    now: i64,
) {
    if player_game_cv.created_at == 0 {
        player_game_cv.created_at = now;
        player_game_cv.bump = bump;
        player_game_cv.reserved = [0u8; 7];
    }
    player_game_cv.registry = registry;
    player_game_cv.player = player;
    player_game_cv.game_id = game_id;
}

fn increment_cv(player_cv: &mut Account<PlayerCv>, input: &MatchProvenanceInput) -> Result<()> {
    player_cv.games_played = player_cv
        .games_played
        .checked_add(1)
        .ok_or(ProvenanceRegistryError::MathOverflow)?;
    player_cv.matches_recorded = player_cv
        .matches_recorded
        .checked_add(1)
        .ok_or(ProvenanceRegistryError::MathOverflow)?;
    player_cv.kills = player_cv
        .kills
        .checked_add(u64::from(input.kills))
        .ok_or(ProvenanceRegistryError::MathOverflow)?;
    player_cv.deaths = player_cv
        .deaths
        .checked_add(u64::from(input.deaths))
        .ok_or(ProvenanceRegistryError::MathOverflow)?;
    player_cv.assists = player_cv
        .assists
        .checked_add(u64::from(input.assists))
        .ok_or(ProvenanceRegistryError::MathOverflow)?;
    player_cv.score = player_cv
        .score
        .checked_add(u64::from(input.score))
        .ok_or(ProvenanceRegistryError::MathOverflow)?;
    if input.won {
        player_cv.wins = player_cv
            .wins
            .checked_add(1)
            .ok_or(ProvenanceRegistryError::MathOverflow)?;
    }
    let now = Clock::get()?.unix_timestamp;
    player_cv.last_match_at = now;
    player_cv.updated_at = now;
    Ok(())
}

fn increment_game_cv(
    player_game_cv: &mut Account<PlayerGameCv>,
    input: &MatchProvenanceInput,
) -> Result<()> {
    player_game_cv.games_played = player_game_cv
        .games_played
        .checked_add(1)
        .ok_or(ProvenanceRegistryError::MathOverflow)?;
    player_game_cv.matches_recorded = player_game_cv
        .matches_recorded
        .checked_add(1)
        .ok_or(ProvenanceRegistryError::MathOverflow)?;
    player_game_cv.kills = player_game_cv
        .kills
        .checked_add(u64::from(input.kills))
        .ok_or(ProvenanceRegistryError::MathOverflow)?;
    player_game_cv.deaths = player_game_cv
        .deaths
        .checked_add(u64::from(input.deaths))
        .ok_or(ProvenanceRegistryError::MathOverflow)?;
    player_game_cv.assists = player_game_cv
        .assists
        .checked_add(u64::from(input.assists))
        .ok_or(ProvenanceRegistryError::MathOverflow)?;
    player_game_cv.score = player_game_cv
        .score
        .checked_add(u64::from(input.score))
        .ok_or(ProvenanceRegistryError::MathOverflow)?;
    if input.won {
        player_game_cv.wins = player_game_cv
            .wins
            .checked_add(1)
            .ok_or(ProvenanceRegistryError::MathOverflow)?;
    }
    let now = Clock::get()?.unix_timestamp;
    player_game_cv.last_match_at = now;
    player_game_cv.updated_at = now;
    Ok(())
}

#[error_code]
pub enum ProvenanceRegistryError {
    #[msg("Only registry admin can call this instruction")]
    UnauthorizedAdmin,
    #[msg("Registry is paused")]
    RegistryPaused,
    #[msg("Reporter is not authorized for this player")]
    UnauthorizedReporter,
    #[msg("Trusted signer list is full")]
    TrustedSignerListFull,
    #[msg("Metadata URI exceeds maximum allowed length")]
    MetadataUriTooLong,
    #[msg("Math overflow")]
    MathOverflow,
}
