use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};
use solana_sha256_hasher::hashv;

declare_id!("DiTw7JwsHqrNZSfHhPDxLAfzKWoCcqpo1Pk4y2toABfK");

const MAX_PLAYERS: usize = 16;
const MAX_GAME_STATE_BYTES: usize = 8192;
const PLUGIN_TRANSITION_MAGIC: [u8; 8] = *b"SNAPTRN1";
const PLUGIN_IX_PREFIX: &[u8] = b"SNAP_AUTH_PLUGIN_V1";
const PLUGIN_HOOK_VALIDATE: u8 = 1;
const PLUGIN_HOOK_APPLY: u8 = 2;

#[program]
pub mod snap_multiplayer_authority {
    use super::*;

    pub fn initialize_engine(
        ctx: Context<InitializeEngine>,
        default_vrf_module: Option<Pubkey>,
    ) -> Result<()> {
        let engine = &mut ctx.accounts.engine;
        let now = Clock::get()?;
        engine.admin = ctx.accounts.admin.key();
        engine.default_vrf_module = default_vrf_module;
        engine.paused = false;
        engine.bump = ctx.bumps.engine;
        engine.created_at = now.unix_timestamp;
        engine.updated_at = now.unix_timestamp;
        Ok(())
    }

    pub fn set_engine_admin(ctx: Context<UpdateEngine>, new_admin: Pubkey) -> Result<()> {
        let engine = &mut ctx.accounts.engine;
        engine.admin = new_admin;
        engine.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn set_engine_pause(ctx: Context<UpdateEngine>, paused: bool) -> Result<()> {
        let engine = &mut ctx.accounts.engine;
        engine.paused = paused;
        engine.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn create_match(ctx: Context<CreateMatch>, args: CreateMatchArgs) -> Result<()> {
        let engine = &ctx.accounts.engine;
        require!(!engine.paused, MultiplayerAuthorityError::EnginePaused);

        require!(
            args.max_players as usize <= MAX_PLAYERS,
            MultiplayerAuthorityError::MaxPlayersTooLarge
        );
        require!(
            args.min_players > 0 && args.min_players <= args.max_players,
            MultiplayerAuthorityError::InvalidMinPlayers
        );
        require!(
            args.max_state_bytes as usize <= MAX_GAME_STATE_BYTES,
            MultiplayerAuthorityError::MaxStateBytesTooLarge
        );
        require!(
            args.initial_state.len() <= args.max_state_bytes as usize,
            MultiplayerAuthorityError::StateTooLarge
        );

        let match_state = &mut ctx.accounts.match_state;
        let now = Clock::get()?;

        match_state.engine = engine.key();
        match_state.match_id = args.match_id;
        match_state.game_id = args.game_id;
        match_state.creator = ctx.accounts.creator.key();
        match_state.players = vec![ctx.accounts.creator.key()];
        match_state.status = MatchStatus::Open;
        match_state.turn_mode = args.turn_mode;
        match_state.min_players = args.min_players;
        match_state.max_players = args.max_players;
        match_state.max_state_bytes = args.max_state_bytes;
        match_state.active_turn_index = 0;
        match_state.current_round = 0;
        match_state.state_version = 0;
        match_state.action_count = 0;
        match_state.game_state = args.initial_state;
        match_state.plugin_program = args.plugin_program;
        match_state.plugin_config_hash = args.plugin_config_hash;
        match_state.vrf_module = args.vrf_module;
        match_state.randomness_root = [0u8; 32];
        match_state.randomness_nonce = 0;
        match_state.bump = ctx.bumps.match_state;
        match_state.locked = false;
        match_state.created_at = now.unix_timestamp;
        match_state.updated_at = now.unix_timestamp;

        emit!(MatchCreated {
            match_state: match_state.key(),
            match_id: match_state.match_id,
            creator: match_state.creator,
            min_players: match_state.min_players,
            max_players: match_state.max_players,
            turn_mode: match_state.turn_mode,
        });

        Ok(())
    }

    pub fn join_match(ctx: Context<JoinMatch>) -> Result<()> {
        let match_state = &mut ctx.accounts.match_state;
        require!(
            match_state.status == MatchStatus::Open,
            MultiplayerAuthorityError::MatchNotOpen
        );
        require!(!match_state.locked, MultiplayerAuthorityError::MatchLocked);
        require!(
            match_state.players.len() < match_state.max_players as usize,
            MultiplayerAuthorityError::MatchFull
        );
        require!(
            !match_state
                .players
                .iter()
                .any(|pk| *pk == ctx.accounts.player.key()),
            MultiplayerAuthorityError::PlayerAlreadyJoined
        );

        match_state.players.push(ctx.accounts.player.key());
        match_state.updated_at = Clock::get()?.unix_timestamp;

        emit!(PlayerJoined {
            match_state: match_state.key(),
            player: ctx.accounts.player.key(),
            player_count: match_state.players.len() as u8,
        });

        Ok(())
    }

    pub fn start_match(ctx: Context<UpdateMatchState>) -> Result<()> {
        let match_state = &mut ctx.accounts.match_state;
        require!(
            match_state.status == MatchStatus::Open,
            MultiplayerAuthorityError::MatchNotOpen
        );
        require!(
            ctx.accounts.authority.key() == match_state.creator,
            MultiplayerAuthorityError::UnauthorizedMatchAuthority
        );
        require!(
            match_state.players.len() >= match_state.min_players as usize,
            MultiplayerAuthorityError::NotEnoughPlayers
        );

        match_state.status = MatchStatus::Started;
        match_state.locked = true;
        match_state.active_turn_index = 0;
        match_state.current_round = 1;
        match_state.updated_at = Clock::get()?.unix_timestamp;

        emit!(MatchStarted {
            match_state: match_state.key(),
            started_by: ctx.accounts.authority.key(),
            player_count: match_state.players.len() as u8,
            active_turn_index: match_state.active_turn_index,
            current_round: match_state.current_round,
        });

        Ok(())
    }

    pub fn end_match(ctx: Context<UpdateMatchState>) -> Result<()> {
        let match_state = &mut ctx.accounts.match_state;
        require!(
            match_state.status == MatchStatus::Started,
            MultiplayerAuthorityError::MatchNotStarted
        );
        require!(
            ctx.accounts.authority.key() == match_state.creator,
            MultiplayerAuthorityError::UnauthorizedMatchAuthority
        );

        match_state.status = MatchStatus::Ended;
        match_state.updated_at = Clock::get()?.unix_timestamp;

        emit!(MatchEnded {
            match_state: match_state.key(),
            ended_by: ctx.accounts.authority.key(),
            final_state_version: match_state.state_version,
            total_actions: match_state.action_count,
        });

        Ok(())
    }

    pub fn submit_action<'info>(
        ctx: Context<'_, '_, '_, 'info, SubmitAction<'info>>,
        args: SubmitActionArgs,
    ) -> Result<()> {
        let engine = &ctx.accounts.engine;
        require!(!engine.paused, MultiplayerAuthorityError::EnginePaused);

        let match_state = &ctx.accounts.match_state;
        require!(
            match_state.status == MatchStatus::Started,
            MultiplayerAuthorityError::MatchNotStarted
        );
        require!(
            args.expected_state_version == match_state.state_version,
            MultiplayerAuthorityError::StateVersionMismatch
        );

        let actor_key = ctx.accounts.actor.key();
        let actor_index = match_state
            .players
            .iter()
            .position(|pk| *pk == actor_key)
            .ok_or(MultiplayerAuthorityError::PlayerNotInMatch)? as u16;

        if match_state.turn_mode == TurnMode::RoundBased {
            let expected_index = if match_state.players.is_empty() {
                0
            } else {
                match_state.active_turn_index % (match_state.players.len() as u16)
            };
            require!(
                actor_index == expected_index,
                MultiplayerAuthorityError::NotPlayersTurn
            );
        }

        let state_version = match_state.state_version;
        let action_count = match_state.action_count;
        let action_index_for_hook = action_count.saturating_add(1);
        let randomness_root = match_state.randomness_root;
        let randomness_nonce = match_state.randomness_nonce;
        let max_state_bytes = match_state.max_state_bytes;
        let plugin_program = match_state.plugin_program;

        let next_state = if let Some(plugin_program) = plugin_program {
            require_keys_eq!(
                ctx.accounts.plugin_program.key(),
                plugin_program,
                MultiplayerAuthorityError::PluginProgramMismatch
            );

            run_plugin_hook(
                &ctx.accounts.match_state,
                &ctx.accounts.actor,
                &ctx.accounts.plugin_transition,
                &ctx.accounts.plugin_program,
                ctx.remaining_accounts,
                PLUGIN_HOOK_VALIDATE,
                args.action_type,
                &args.payload,
                state_version,
                action_index_for_hook,
                randomness_root,
                randomness_nonce,
            )?;

            run_plugin_hook(
                &ctx.accounts.match_state,
                &ctx.accounts.actor,
                &ctx.accounts.plugin_transition,
                &ctx.accounts.plugin_program,
                ctx.remaining_accounts,
                PLUGIN_HOOK_APPLY,
                args.action_type,
                &args.payload,
                state_version,
                action_index_for_hook,
                randomness_root,
                randomness_nonce,
            )?;

            read_plugin_transition(
                &ctx.accounts.plugin_transition,
                state_version,
                max_state_bytes,
            )?
        } else {
            require!(
                args.payload.len() <= max_state_bytes as usize,
                MultiplayerAuthorityError::StateTooLarge
            );
            args.payload.clone()
        };

        let now = Clock::get()?;
        let payload_hash = hashv(&[args.payload.as_slice()]).to_bytes();
        let state_hash = hashv(&[next_state.as_slice()]).to_bytes();
        let action_index = action_count
            .checked_add(1)
            .ok_or(MultiplayerAuthorityError::MathOverflow)?;
        let next_state_version = state_version
            .checked_add(1)
            .ok_or(MultiplayerAuthorityError::MathOverflow)?;

        let match_state = &mut ctx.accounts.match_state;

        match_state.game_state = next_state;
        match_state.action_count = action_index;
        match_state.state_version = next_state_version;

        advance_turn(match_state, actor_index)?;

        let derived_randomness = derive_match_randomness(
            &match_state.randomness_root,
            match_state.randomness_nonce,
            action_index,
            args.action_type,
            actor_key,
        );

        match_state.updated_at = now.unix_timestamp;

        emit!(ActionSubmitted {
            match_state: match_state.key(),
            actor: actor_key,
            action_index,
            action_type: args.action_type,
            payload_hash,
            state_hash,
            state_version: match_state.state_version,
            active_turn_index: match_state.active_turn_index,
            current_round: match_state.current_round,
            derived_randomness,
        });

        Ok(())
    }

    pub fn record_randomness(
        ctx: Context<RecordRandomness>,
        randomness_root: [u8; 32],
        randomness_nonce: u64,
    ) -> Result<()> {
        let match_state = &mut ctx.accounts.match_state;
        let allowed = match_state
            .vrf_module
            .or(ctx.accounts.engine.default_vrf_module)
            .ok_or(MultiplayerAuthorityError::MissingVrfModule)?;
        require_keys_eq!(
            ctx.accounts.vrf_authority.key(),
            allowed,
            MultiplayerAuthorityError::UnauthorizedVrfAuthority
        );

        match_state.randomness_root = randomness_root;
        match_state.randomness_nonce = randomness_nonce;
        match_state.updated_at = Clock::get()?.unix_timestamp;

        emit!(RandomnessRecorded {
            match_state: match_state.key(),
            vrf_authority: ctx.accounts.vrf_authority.key(),
            randomness_root,
            randomness_nonce,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeEngine<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + MultiplayerEngine::INIT_SPACE,
        seeds = [b"engine"],
        bump
    )]
    pub engine: Account<'info, MultiplayerEngine>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateEngine<'info> {
    #[account(
        mut,
        seeds = [b"engine"],
        bump = engine.bump,
        has_one = admin @ MultiplayerAuthorityError::UnauthorizedAdmin
    )]
    pub engine: Account<'info, MultiplayerEngine>,
    pub admin: Signer<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateMatchArgs {
    pub match_id: [u8; 32],
    pub game_id: [u8; 32],
    pub min_players: u8,
    pub max_players: u8,
    pub turn_mode: TurnMode,
    pub max_state_bytes: u16,
    pub plugin_program: Option<Pubkey>,
    pub plugin_config_hash: [u8; 32],
    pub vrf_module: Option<Pubkey>,
    pub initial_state: Vec<u8>,
}

#[derive(Accounts)]
#[instruction(args: CreateMatchArgs)]
pub struct CreateMatch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        seeds = [b"engine"],
        bump = engine.bump
    )]
    pub engine: Account<'info, MultiplayerEngine>,
    #[account(
        init,
        payer = creator,
        space = 8 + MatchState::INIT_SPACE,
        seeds = [b"match", engine.key().as_ref(), args.match_id.as_ref()],
        bump
    )]
    pub match_state: Account<'info, MatchState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinMatch<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(
        seeds = [b"engine"],
        bump = engine.bump
    )]
    pub engine: Account<'info, MultiplayerEngine>,
    #[account(
        mut,
        has_one = engine @ MultiplayerAuthorityError::EngineMismatch,
        seeds = [b"match", engine.key().as_ref(), match_state.match_id.as_ref()],
        bump = match_state.bump
    )]
    pub match_state: Account<'info, MatchState>,
}

#[derive(Accounts)]
pub struct UpdateMatchState<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"engine"],
        bump = engine.bump
    )]
    pub engine: Account<'info, MultiplayerEngine>,
    #[account(
        mut,
        has_one = engine @ MultiplayerAuthorityError::EngineMismatch,
        seeds = [b"match", engine.key().as_ref(), match_state.match_id.as_ref()],
        bump = match_state.bump
    )]
    pub match_state: Account<'info, MatchState>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SubmitActionArgs {
    pub action_type: u16,
    pub payload: Vec<u8>,
    pub expected_state_version: u64,
}

#[derive(Accounts)]
pub struct SubmitAction<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,
    #[account(
        seeds = [b"engine"],
        bump = engine.bump
    )]
    pub engine: Account<'info, MultiplayerEngine>,
    #[account(
        mut,
        has_one = engine @ MultiplayerAuthorityError::EngineMismatch,
        seeds = [b"match", engine.key().as_ref(), match_state.match_id.as_ref()],
        bump = match_state.bump
    )]
    pub match_state: Account<'info, MatchState>,
    /// CHECK: validated against match_state.plugin_program when plugin is enabled.
    pub plugin_program: UncheckedAccount<'info>,
    /// CHECK: plugin-owned transition account. Only read by this program.
    pub plugin_transition: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RecordRandomness<'info> {
    pub vrf_authority: Signer<'info>,
    #[account(
        seeds = [b"engine"],
        bump = engine.bump
    )]
    pub engine: Account<'info, MultiplayerEngine>,
    #[account(
        mut,
        has_one = engine @ MultiplayerAuthorityError::EngineMismatch,
        seeds = [b"match", engine.key().as_ref(), match_state.match_id.as_ref()],
        bump = match_state.bump
    )]
    pub match_state: Account<'info, MatchState>,
}

#[account]
#[derive(InitSpace)]
pub struct MultiplayerEngine {
    pub admin: Pubkey,
    pub default_vrf_module: Option<Pubkey>,
    pub paused: bool,
    pub bump: u8,
    pub reserved: [u8; 6],
    pub created_at: i64,
    pub updated_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct MatchState {
    pub engine: Pubkey,
    pub match_id: [u8; 32],
    pub game_id: [u8; 32],
    pub creator: Pubkey,
    #[max_len(MAX_PLAYERS)]
    pub players: Vec<Pubkey>,
    pub status: MatchStatus,
    pub turn_mode: TurnMode,
    pub min_players: u8,
    pub max_players: u8,
    pub max_state_bytes: u16,
    pub active_turn_index: u16,
    pub current_round: u32,
    pub state_version: u64,
    pub action_count: u64,
    #[max_len(MAX_GAME_STATE_BYTES)]
    pub game_state: Vec<u8>,
    pub plugin_program: Option<Pubkey>,
    pub plugin_config_hash: [u8; 32],
    pub vrf_module: Option<Pubkey>,
    pub randomness_root: [u8; 32],
    pub randomness_nonce: u64,
    pub bump: u8,
    pub locked: bool,
    pub reserved: [u8; 6],
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum MatchStatus {
    Open,
    Started,
    Ended,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum TurnMode {
    RoundBased,
    FreeTurn,
}

#[event]
pub struct MatchCreated {
    pub match_state: Pubkey,
    pub match_id: [u8; 32],
    pub creator: Pubkey,
    pub min_players: u8,
    pub max_players: u8,
    pub turn_mode: TurnMode,
}

#[event]
pub struct PlayerJoined {
    pub match_state: Pubkey,
    pub player: Pubkey,
    pub player_count: u8,
}

#[event]
pub struct MatchStarted {
    pub match_state: Pubkey,
    pub started_by: Pubkey,
    pub player_count: u8,
    pub active_turn_index: u16,
    pub current_round: u32,
}

#[event]
pub struct ActionSubmitted {
    pub match_state: Pubkey,
    pub actor: Pubkey,
    pub action_index: u64,
    pub action_type: u16,
    pub payload_hash: [u8; 32],
    pub state_hash: [u8; 32],
    pub state_version: u64,
    pub active_turn_index: u16,
    pub current_round: u32,
    pub derived_randomness: [u8; 32],
}

#[event]
pub struct MatchEnded {
    pub match_state: Pubkey,
    pub ended_by: Pubkey,
    pub final_state_version: u64,
    pub total_actions: u64,
}

#[event]
pub struct RandomnessRecorded {
    pub match_state: Pubkey,
    pub vrf_authority: Pubkey,
    pub randomness_root: [u8; 32],
    pub randomness_nonce: u64,
}

fn advance_turn(match_state: &mut MatchState, actor_index: u16) -> Result<()> {
    if match_state.turn_mode == TurnMode::FreeTurn {
        match_state.active_turn_index = actor_index;
        return Ok(());
    }

    if match_state.players.is_empty() {
        return Ok(());
    }

    let player_count = match_state.players.len() as u16;
    let next = (match_state.active_turn_index + 1) % player_count;
    if next == 0 {
        match_state.current_round = match_state
            .current_round
            .checked_add(1)
            .ok_or(MultiplayerAuthorityError::MathOverflow)?;
    }
    match_state.active_turn_index = next;
    Ok(())
}

fn run_plugin_hook<'info>(
    match_state: &Account<'info, MatchState>,
    actor: &Signer<'info>,
    plugin_transition: &UncheckedAccount<'info>,
    plugin_program: &UncheckedAccount<'info>,
    remaining_accounts: &[AccountInfo<'info>],
    hook_kind: u8,
    action_type: u16,
    payload: &[u8],
    state_version: u64,
    action_index: u64,
    randomness_root: [u8; 32],
    randomness_nonce: u64,
) -> Result<()> {
    let mut metas = vec![
        AccountMeta::new(match_state.key(), false),
        AccountMeta::new_readonly(actor.key(), true),
        AccountMeta::new(plugin_transition.key(), false),
    ];
    for acc in remaining_accounts.iter() {
        if acc.is_writable {
            metas.push(AccountMeta::new(*acc.key, acc.is_signer));
        } else {
            metas.push(AccountMeta::new_readonly(*acc.key, acc.is_signer));
        }
    }

    let ix = Instruction {
        program_id: plugin_program.key(),
        accounts: metas,
        data: encode_plugin_hook_ix(
            hook_kind,
            action_type,
            payload,
            state_version,
            action_index,
            randomness_root,
            randomness_nonce,
        ),
    };

    let mut infos = vec![
        match_state.to_account_info(),
        actor.to_account_info(),
        plugin_transition.to_account_info(),
    ];
    infos.extend(remaining_accounts.iter().cloned());
    infos.push(plugin_program.to_account_info());

    invoke(&ix, &infos)?;
    Ok(())
}

fn encode_plugin_hook_ix(
    hook_kind: u8,
    action_type: u16,
    payload: &[u8],
    state_version: u64,
    action_index: u64,
    randomness_root: [u8; 32],
    randomness_nonce: u64,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(PLUGIN_IX_PREFIX.len() + 1 + 2 + 4 + payload.len() + 8 + 8 + 32 + 8);
    out.extend_from_slice(PLUGIN_IX_PREFIX);
    out.push(hook_kind);
    out.extend_from_slice(&action_type.to_le_bytes());
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    out.extend_from_slice(&state_version.to_le_bytes());
    out.extend_from_slice(&action_index.to_le_bytes());
    out.extend_from_slice(&randomness_root);
    out.extend_from_slice(&randomness_nonce.to_le_bytes());
    out
}

fn read_plugin_transition(
    transition: &UncheckedAccount,
    current_state_version: u64,
    max_state_bytes: u16,
) -> Result<Vec<u8>> {
    let data = transition.try_borrow_data()?;
    require!(
        data.len() >= 8 + 8 + 32 + 2,
        MultiplayerAuthorityError::PluginTransitionMalformed
    );

    require!(
        data[0..8] == PLUGIN_TRANSITION_MAGIC,
        MultiplayerAuthorityError::PluginTransitionMalformed
    );

    let mut cursor = 8;
    let next_state_version = u64::from_le_bytes(data[cursor..cursor + 8].try_into().unwrap());
    cursor += 8;

    let expected_next = current_state_version
        .checked_add(1)
        .ok_or(MultiplayerAuthorityError::MathOverflow)?;
    require!(
        next_state_version == expected_next,
        MultiplayerAuthorityError::PluginTransitionVersionMismatch
    );

    let expected_hash: [u8; 32] = data[cursor..cursor + 32].try_into().unwrap();
    cursor += 32;

    let declared_len = u16::from_le_bytes(data[cursor..cursor + 2].try_into().unwrap());
    cursor += 2;

    require!(
        declared_len <= max_state_bytes,
        MultiplayerAuthorityError::StateTooLarge
    );

    let state_len = declared_len as usize;
    require!(
        data.len() >= cursor + state_len,
        MultiplayerAuthorityError::PluginTransitionMalformed
    );

    let next_state = data[cursor..cursor + state_len].to_vec();
    let actual_hash = hashv(&[next_state.as_slice()]).to_bytes();
    require!(
        actual_hash == expected_hash,
        MultiplayerAuthorityError::PluginTransitionHashMismatch
    );

    Ok(next_state)
}

fn derive_match_randomness(
    root: &[u8; 32],
    nonce: u64,
    action_index: u64,
    action_type: u16,
    actor: Pubkey,
) -> [u8; 32] {
    hashv(&[
        b"SNAP_MATCH_RANDOM_V1".as_ref(),
        root.as_ref(),
        &nonce.to_le_bytes(),
        &action_index.to_le_bytes(),
        &action_type.to_le_bytes(),
        actor.as_ref(),
    ])
    .to_bytes()
}

#[error_code]
pub enum MultiplayerAuthorityError {
    #[msg("Only engine admin can call this instruction")]
    UnauthorizedAdmin,
    #[msg("Only match creator can call this instruction")]
    UnauthorizedMatchAuthority,
    #[msg("Engine is paused")]
    EnginePaused,
    #[msg("Match is not open")]
    MatchNotOpen,
    #[msg("Match is not started")]
    MatchNotStarted,
    #[msg("Match has been locked")]
    MatchLocked,
    #[msg("Match has reached max players")]
    MatchFull,
    #[msg("Player already joined this match")]
    PlayerAlreadyJoined,
    #[msg("Player is not part of this match")]
    PlayerNotInMatch,
    #[msg("Not enough players to start")]
    NotEnoughPlayers,
    #[msg("It is not this player's turn")]
    NotPlayersTurn,
    #[msg("Maximum players exceeds engine cap")]
    MaxPlayersTooLarge,
    #[msg("Invalid minimum players")]
    InvalidMinPlayers,
    #[msg("Game state payload is too large")]
    StateTooLarge,
    #[msg("Configured max_state_bytes exceeds engine cap")]
    MaxStateBytesTooLarge,
    #[msg("State version mismatch")]
    StateVersionMismatch,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Engine account mismatch")]
    EngineMismatch,
    #[msg("Plugin program mismatch")]
    PluginProgramMismatch,
    #[msg("Plugin transition account malformed")]
    PluginTransitionMalformed,
    #[msg("Plugin transition version mismatch")]
    PluginTransitionVersionMismatch,
    #[msg("Plugin transition hash mismatch")]
    PluginTransitionHashMismatch,
    #[msg("Match has no VRF module configured")]
    MissingVrfModule,
    #[msg("Unauthorized VRF authority")]
    UnauthorizedVrfAuthority,
}
