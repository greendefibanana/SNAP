use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

declare_id!("6MNEnDDewn4VG2TKhQwk16D6VkvpvJLDzNk1PC37jfoA");

#[program]
pub mod snap_vrf_engine {
    use super::*;

    pub fn initialize_engine(
        ctx: Context<InitializeEngine>,
        vrf_authority: Pubkey,
        min_request_confirmations: u8,
    ) -> Result<()> {
        let engine = &mut ctx.accounts.engine;
        let clock = Clock::get()?;
        engine.admin = ctx.accounts.admin.key();
        engine.vrf_authority = vrf_authority;
        engine.bump = ctx.bumps.engine;
        engine.paused = false;
        engine.min_request_confirmations = min_request_confirmations;
        engine.reserved = [0u8; 5];
        engine.created_at = clock.unix_timestamp;
        engine.updated_at = clock.unix_timestamp;
        Ok(())
    }

    pub fn set_engine_admin(ctx: Context<UpdateEngine>, new_admin: Pubkey) -> Result<()> {
        let engine = &mut ctx.accounts.engine;
        engine.admin = new_admin;
        engine.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn set_vrf_authority(ctx: Context<UpdateEngine>, new_vrf_authority: Pubkey) -> Result<()> {
        let engine = &mut ctx.accounts.engine;
        engine.vrf_authority = new_vrf_authority;
        engine.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn set_engine_pause(ctx: Context<UpdateEngine>, paused: bool) -> Result<()> {
        let engine = &mut ctx.accounts.engine;
        engine.paused = paused;
        engine.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn initialize_match(
        ctx: Context<InitializeMatch>,
        match_id: [u8; 32],
        game_id: [u8; 32],
    ) -> Result<()> {
        let match_state = &mut ctx.accounts.match_state;
        let now = Clock::get()?;
        match_state.engine = ctx.accounts.engine.key();
        match_state.match_id = match_id;
        match_state.game_id = game_id;
        match_state.request_count = 0;
        match_state.match_seed = [0u8; 32];
        match_state.seed_locked = false;
        match_state.bump = ctx.bumps.match_state;
        match_state.created_slot = now.slot;
        match_state.updated_slot = now.slot;
        match_state.created_at = now.unix_timestamp;
        Ok(())
    }

    pub fn set_namespace_config(
        ctx: Context<SetNamespaceConfig>,
        game_id: [u8; 32],
        namespace: RandomnessNamespace,
        drop_tier_weights: [u16; 4],
        weighted_outcome_weights: [u16; 8],
        event_trigger_bps: u16,
        modifier_activation_bps: [u16; 8],
    ) -> Result<()> {
        require!(event_trigger_bps <= BPS_DENOMINATOR, VrfEngineError::InvalidBps);
        require!(
            drop_tier_weights.iter().copied().map(u32::from).sum::<u32>() > 0,
            VrfEngineError::InvalidWeights
        );
        require!(
            weighted_outcome_weights
                .iter()
                .copied()
                .map(u32::from)
                .sum::<u32>()
                > 0,
            VrfEngineError::InvalidWeights
        );
        for bps in modifier_activation_bps {
            require!(bps <= BPS_DENOMINATOR, VrfEngineError::InvalidBps);
        }

        let cfg = &mut ctx.accounts.namespace_config;
        cfg.engine = ctx.accounts.engine.key();
        cfg.game_id = game_id;
        cfg.namespace = namespace;
        cfg.bump = ctx.bumps.namespace_config;
        cfg.drop_tier_weights = drop_tier_weights;
        cfg.weighted_outcome_weights = weighted_outcome_weights;
        cfg.event_trigger_bps = event_trigger_bps;
        cfg.modifier_activation_bps = modifier_activation_bps;
        Ok(())
    }

    pub fn request_randomness(
        ctx: Context<RequestRandomness>,
        request_id: u64,
        randomness_type: RandomnessType,
        namespace: RandomnessNamespace,
        request_nonce: u64,
        metadata: [u8; 32],
    ) -> Result<()> {
        let engine = &ctx.accounts.engine;
        require!(!engine.paused, VrfEngineError::EnginePaused);

        let match_state = &mut ctx.accounts.match_state;
        require!(
            request_id == match_state.request_count.checked_add(1).ok_or(VrfEngineError::MathOverflow)?,
            VrfEngineError::InvalidRequestId
        );

        let now = Clock::get()?;
        let request = &mut ctx.accounts.request;
        request.engine = engine.key();
        request.match_state = match_state.key();
        request.request_id = request_id;
        request.request_nonce = request_nonce;
        request.randomness_type = randomness_type;
        request.namespace = namespace;
        request.status = RequestStatus::Pending;
        request.requested_by = ctx.accounts.requester.key();
        request.requested_at = now.unix_timestamp;
        request.requested_slot = now.slot;
        request.fulfilled_slot = 0;
        request.fulfilled_at = 0;
        request.consumed_at = 0;
        request.vrf_seed = [0u8; 32];
        request.vrf_output = [0u8; 32];
        request.metadata = metadata;
        request.external_request_id = [0u8; 32];
        request.bump = ctx.bumps.request;

        match_state.request_count = request_id;
        match_state.updated_slot = now.slot;

        emit!(RandomnessRequested {
            match_state: match_state.key(),
            request: request.key(),
            request_id,
            randomness_type,
            namespace,
            requester: ctx.accounts.requester.key(),
        });

        Ok(())
    }

    pub fn record_external_request_id(
        ctx: Context<RecordExternalRequestId>,
        external_request_id: [u8; 32],
    ) -> Result<()> {
        let request = &mut ctx.accounts.request;
        require!(
            request.status == RequestStatus::Pending,
            VrfEngineError::RequestNotPending
        );
        request.external_request_id = external_request_id;
        Ok(())
    }

    pub fn fulfill_randomness(
        ctx: Context<FulfillRandomness>,
        vrf_seed: [u8; 32],
        vrf_output: [u8; 32],
    ) -> Result<()> {
        let engine = &ctx.accounts.engine;
        require_keys_eq!(
            ctx.accounts.vrf_authority.key(),
            engine.vrf_authority,
            VrfEngineError::UnauthorizedVrfAuthority
        );

        let request = &mut ctx.accounts.request;
        require!(
            request.status == RequestStatus::Pending,
            VrfEngineError::RequestNotPending
        );

        let now = Clock::get()?;
        request.vrf_seed = vrf_seed;
        request.vrf_output = vrf_output;
        request.status = RequestStatus::Fulfilled;
        request.fulfilled_slot = now.slot;
        request.fulfilled_at = now.unix_timestamp;

        let match_state = &mut ctx.accounts.match_state;
        if request.randomness_type == RandomnessType::MatchSeed {
            require!(!match_state.seed_locked, VrfEngineError::MatchSeedAlreadyLocked);
            let match_seed = derive_random_value_with_label(
                &vrf_output,
                request.namespace.as_seed_label(),
                b"MATCH_SEED_LOCK",
            );
            match_state.match_seed = match_seed;
            match_state.seed_locked = true;
            emit!(MatchSeedLocked {
                match_state: match_state.key(),
                request: request.key(),
                match_seed,
            });
        }
        match_state.updated_slot = now.slot;

        emit!(RandomnessFulfilled {
            match_state: match_state.key(),
            request: request.key(),
            request_id: request.request_id,
            randomness_type: request.randomness_type,
            namespace: request.namespace,
            fulfilled_slot: now.slot,
        });

        Ok(())
    }

    pub fn consume_randomness(ctx: Context<ConsumeRandomness>) -> Result<()> {
        let request = &mut ctx.accounts.request;
        require!(
            request.status == RequestStatus::Fulfilled,
            VrfEngineError::RequestNotFulfilled
        );
        let namespace_cfg = &ctx.accounts.namespace_config;
        require!(
            namespace_cfg.namespace == request.namespace,
            VrfEngineError::NamespaceMismatch
        );
        require!(
            namespace_cfg.game_id == ctx.accounts.match_state.game_id,
            VrfEngineError::GameIdMismatch
        );

        let route = route_from_vrf_output(&request.vrf_output, request.namespace, namespace_cfg)?;

        request.status = RequestStatus::Consumed;
        request.consumed_at = Clock::get()?.unix_timestamp;

        emit!(RandomnessConsumed {
            match_state: ctx.accounts.match_state.key(),
            request: request.key(),
            request_id: request.request_id,
            namespace: request.namespace,
            tier: route.tier,
            weighted_outcome_index: route.weighted_outcome_index,
            event_triggered: route.event_triggered,
            modifier_mask: route.modifier_mask,
            derived_value: route.derived_value,
        });

        Ok(())
    }

    pub fn derive_random_value(
        _ctx: Context<NoAccounts>,
        seed: [u8; 32],
        namespace: RandomnessNamespace,
        salt: [u8; 32],
    ) -> Result<()> {
        let value = derive_random_value_with_label(&seed, namespace.as_seed_label(), &salt);
        emit!(DerivedValueComputed {
            namespace,
            seed,
            salt,
            derived_value: value,
        });
        Ok(())
    }
}

const BPS_DENOMINATOR: u16 = 10_000;

#[derive(Accounts)]
pub struct InitializeEngine<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + VrfEngine::INIT_SPACE,
        seeds = [b"engine"],
        bump
    )]
    pub engine: Account<'info, VrfEngine>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateEngine<'info> {
    #[account(
        mut,
        seeds = [b"engine"],
        bump = engine.bump,
        has_one = admin @ VrfEngineError::UnauthorizedAdmin
    )]
    pub engine: Account<'info, VrfEngine>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(match_id: [u8; 32])]
pub struct InitializeMatch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"engine"],
        bump = engine.bump
    )]
    pub engine: Account<'info, VrfEngine>,
    #[account(
        init,
        payer = payer,
        space = 8 + MatchRandomness::INIT_SPACE,
        seeds = [b"match", engine.key().as_ref(), match_id.as_ref()],
        bump
    )]
    pub match_state: Account<'info, MatchRandomness>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game_id: [u8; 32], namespace: RandomnessNamespace)]
pub struct SetNamespaceConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [b"engine"],
        bump = engine.bump,
        has_one = admin @ VrfEngineError::UnauthorizedAdmin
    )]
    pub engine: Account<'info, VrfEngine>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + NamespaceConfig::INIT_SPACE,
        seeds = [b"namespace", engine.key().as_ref(), game_id.as_ref(), namespace.as_seed_label()],
        bump
    )]
    pub namespace_config: Account<'info, NamespaceConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(request_id: u64)]
pub struct RequestRandomness<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    #[account(
        seeds = [b"engine"],
        bump = engine.bump
    )]
    pub engine: Account<'info, VrfEngine>,
    #[account(
        mut,
        seeds = [b"match", engine.key().as_ref(), match_state.match_id.as_ref()],
        bump = match_state.bump
    )]
    pub match_state: Account<'info, MatchRandomness>,
    #[account(
        init,
        payer = requester,
        space = 8 + RandomnessRequest::INIT_SPACE,
        seeds = [b"request", match_state.key().as_ref(), &request_id.to_le_bytes()],
        bump
    )]
    pub request: Account<'info, RandomnessRequest>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordExternalRequestId<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [b"engine"],
        bump = engine.bump,
        has_one = admin @ VrfEngineError::UnauthorizedAdmin
    )]
    pub engine: Account<'info, VrfEngine>,
    #[account(
        mut,
        has_one = engine @ VrfEngineError::EngineMismatch
    )]
    pub request: Account<'info, RandomnessRequest>,
}

#[derive(Accounts)]
pub struct FulfillRandomness<'info> {
    pub vrf_authority: Signer<'info>,
    #[account(
        seeds = [b"engine"],
        bump = engine.bump
    )]
    pub engine: Account<'info, VrfEngine>,
    #[account(
        mut,
        seeds = [b"match", engine.key().as_ref(), match_state.match_id.as_ref()],
        bump = match_state.bump
    )]
    pub match_state: Account<'info, MatchRandomness>,
    #[account(
        mut,
        has_one = engine @ VrfEngineError::EngineMismatch,
        has_one = match_state @ VrfEngineError::MatchMismatch
    )]
    pub request: Account<'info, RandomnessRequest>,
}

#[derive(Accounts)]
pub struct ConsumeRandomness<'info> {
    pub consumer: Signer<'info>,
    #[account(
        seeds = [b"engine"],
        bump = engine.bump
    )]
    pub engine: Account<'info, VrfEngine>,
    #[account(
        seeds = [b"match", engine.key().as_ref(), match_state.match_id.as_ref()],
        bump = match_state.bump
    )]
    pub match_state: Account<'info, MatchRandomness>,
    #[account(
        mut,
        has_one = engine @ VrfEngineError::EngineMismatch,
        has_one = match_state @ VrfEngineError::MatchMismatch
    )]
    pub request: Account<'info, RandomnessRequest>,
    #[account(
        seeds = [
            b"namespace",
            engine.key().as_ref(),
            match_state.game_id.as_ref(),
            request.namespace.as_seed_label()
        ],
        bump = namespace_config.bump
    )]
    pub namespace_config: Account<'info, NamespaceConfig>,
}

#[derive(Accounts)]
pub struct NoAccounts {}

#[account]
pub struct VrfEngine {
    pub admin: Pubkey,
    pub vrf_authority: Pubkey,
    pub bump: u8,
    pub paused: bool,
    pub min_request_confirmations: u8,
    pub reserved: [u8; 5],
    pub created_at: i64,
    pub updated_at: i64,
}

impl VrfEngine {
    pub const INIT_SPACE: usize = 32 + 32 + 1 + 1 + 1 + 5 + 8 + 8;
}

#[account]
pub struct MatchRandomness {
    pub engine: Pubkey,
    pub match_id: [u8; 32],
    pub game_id: [u8; 32],
    pub request_count: u64,
    pub match_seed: [u8; 32],
    pub seed_locked: bool,
    pub bump: u8,
    pub reserved: [u8; 6],
    pub created_slot: u64,
    pub updated_slot: u64,
    pub created_at: i64,
}

impl MatchRandomness {
    pub const INIT_SPACE: usize = 32 + 32 + 32 + 8 + 32 + 1 + 1 + 6 + 8 + 8 + 8;
}

#[account]
pub struct RandomnessRequest {
    pub engine: Pubkey,
    pub match_state: Pubkey,
    pub request_id: u64,
    pub request_nonce: u64,
    pub randomness_type: RandomnessType,
    pub namespace: RandomnessNamespace,
    pub status: RequestStatus,
    pub requested_by: Pubkey,
    pub requested_at: i64,
    pub requested_slot: u64,
    pub fulfilled_at: i64,
    pub fulfilled_slot: u64,
    pub consumed_at: i64,
    pub vrf_seed: [u8; 32],
    pub vrf_output: [u8; 32],
    pub metadata: [u8; 32],
    pub external_request_id: [u8; 32],
    pub bump: u8,
    pub reserved: [u8; 7],
}

impl RandomnessRequest {
    pub const INIT_SPACE: usize =
        32 + 32 + 8 + 8 + 1 + 1 + 1 + 32 + 8 + 8 + 8 + 8 + 8 + 32 + 32 + 32 + 32 + 1 + 7;
}

#[account]
pub struct NamespaceConfig {
    pub engine: Pubkey,
    pub game_id: [u8; 32],
    pub namespace: RandomnessNamespace,
    pub drop_tier_weights: [u16; 4],
    pub weighted_outcome_weights: [u16; 8],
    pub event_trigger_bps: u16,
    pub modifier_activation_bps: [u16; 8],
    pub bump: u8,
    pub reserved: [u8; 7],
}

impl NamespaceConfig {
    pub const INIT_SPACE: usize = 32 + 32 + 1 + (2 * 4) + (2 * 8) + 2 + (2 * 8) + 1 + 7;
}

#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Debug,
    InitSpace
)]
pub enum RandomnessType {
    Drop,
    MatchSeed,
    Loot,
    Card,
    ArenaEvent,
    Generic,
}

#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Debug,
    InitSpace
)]
pub enum RandomnessNamespace {
    Drop,
    MatchRule,
    Loot,
    Card,
    ArenaEvent,
}

impl RandomnessNamespace {
    pub fn as_seed_label(&self) -> &'static [u8] {
        match self {
            RandomnessNamespace::Drop => b"DROP",
            RandomnessNamespace::MatchRule => b"MATCH_RULE",
            RandomnessNamespace::Loot => b"LOOT",
            RandomnessNamespace::Card => b"CARD",
            RandomnessNamespace::ArenaEvent => b"ARENA_EVENT",
        }
    }
}

#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Debug,
    InitSpace
)]
pub enum RequestStatus {
    Pending,
    Fulfilled,
    Consumed,
}

#[event]
pub struct RandomnessRequested {
    pub match_state: Pubkey,
    pub request: Pubkey,
    pub request_id: u64,
    pub randomness_type: RandomnessType,
    pub namespace: RandomnessNamespace,
    pub requester: Pubkey,
}

#[event]
pub struct RandomnessFulfilled {
    pub match_state: Pubkey,
    pub request: Pubkey,
    pub request_id: u64,
    pub randomness_type: RandomnessType,
    pub namespace: RandomnessNamespace,
    pub fulfilled_slot: u64,
}

#[event]
pub struct MatchSeedLocked {
    pub match_state: Pubkey,
    pub request: Pubkey,
    pub match_seed: [u8; 32],
}

#[event]
pub struct RandomnessConsumed {
    pub match_state: Pubkey,
    pub request: Pubkey,
    pub request_id: u64,
    pub namespace: RandomnessNamespace,
    pub tier: DropTier,
    pub weighted_outcome_index: u8,
    pub event_triggered: bool,
    pub modifier_mask: u16,
    pub derived_value: [u8; 32],
}

#[event]
pub struct DerivedValueComputed {
    pub namespace: RandomnessNamespace,
    pub seed: [u8; 32],
    pub salt: [u8; 32],
    pub derived_value: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum DropTier {
    Common,
    Rare,
    Epic,
    Legendary,
}

pub struct RoutedOutcome {
    pub tier: DropTier,
    pub weighted_outcome_index: u8,
    pub event_triggered: bool,
    pub modifier_mask: u16,
    pub derived_value: [u8; 32],
}

pub fn route_from_vrf_output(
    vrf_output: &[u8; 32],
    namespace: RandomnessNamespace,
    cfg: &NamespaceConfig,
) -> Result<RoutedOutcome> {
    let tier_seed = derive_random_value_with_label(vrf_output, namespace.as_seed_label(), b"TIER");
    let weighted_seed =
        derive_random_value_with_label(vrf_output, namespace.as_seed_label(), b"WEIGHTED");
    let trigger_seed =
        derive_random_value_with_label(vrf_output, namespace.as_seed_label(), b"TRIGGER");
    let modifier_seed =
        derive_random_value_with_label(vrf_output, namespace.as_seed_label(), b"MODIFIERS");

    let tier_idx = weighted_choice(&cfg.drop_tier_weights, u64_from_32(&tier_seed))?;
    let tier = match tier_idx {
        0 => DropTier::Common,
        1 => DropTier::Rare,
        2 => DropTier::Epic,
        3 => DropTier::Legendary,
        _ => return err!(VrfEngineError::InvalidRouterState),
    };

    let weighted_outcome_idx = weighted_choice(&cfg.weighted_outcome_weights, u64_from_32(&weighted_seed))? as u8;
    let event_triggered = (u64_from_32(&trigger_seed) % u64::from(BPS_DENOMINATOR))
        < u64::from(cfg.event_trigger_bps);
    let modifier_mask = resolve_modifier_mask(&modifier_seed, &cfg.modifier_activation_bps);

    Ok(RoutedOutcome {
        tier,
        weighted_outcome_index: weighted_outcome_idx,
        event_triggered,
        modifier_mask,
        derived_value: derive_random_value_with_label(vrf_output, namespace.as_seed_label(), b"OUTCOME"),
    })
}

fn weighted_choice<const N: usize>(weights: &[u16; N], roll: u64) -> Result<usize> {
    let total: u64 = weights.iter().map(|w| u64::from(*w)).sum();
    require!(total > 0, VrfEngineError::InvalidWeights);
    let mut point = roll % total;
    for (idx, weight) in weights.iter().enumerate() {
        let w = u64::from(*weight);
        if point < w {
            return Ok(idx);
        }
        point = point.saturating_sub(w);
    }
    err!(VrfEngineError::InvalidRouterState)
}

fn resolve_modifier_mask(seed: &[u8; 32], modifier_activation_bps: &[u16; 8]) -> u16 {
    let mut mask: u16 = 0;
    for (i, bps) in modifier_activation_bps.iter().enumerate() {
        let step_seed = derive_random_value_with_label(seed, b"MODIFIER_STEP", &[i as u8]);
        let value = u64_from_32(&step_seed) % u64::from(BPS_DENOMINATOR);
        if value < u64::from(*bps) {
            mask |= 1u16 << i;
        }
    }
    mask
}

fn u64_from_32(input: &[u8; 32]) -> u64 {
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&input[..8]);
    u64::from_le_bytes(bytes)
}

fn derive_random_value_with_label(
    seed: &[u8; 32],
    namespace_label: &[u8],
    label: &[u8],
) -> [u8; 32] {
    hashv(&[b"SNAP_VRF_ENGINE_V1".as_ref(), seed.as_ref(), namespace_label, label]).to_bytes()
}

#[error_code]
pub enum VrfEngineError {
    #[msg("Only engine admin can call this instruction")]
    UnauthorizedAdmin,
    #[msg("Only the configured VRF authority can fulfill randomness")]
    UnauthorizedVrfAuthority,
    #[msg("Engine is paused")]
    EnginePaused,
    #[msg("Invalid request id sequence")]
    InvalidRequestId,
    #[msg("The request is not in pending status")]
    RequestNotPending,
    #[msg("The request is not fulfilled yet")]
    RequestNotFulfilled,
    #[msg("Match seed is already locked")]
    MatchSeedAlreadyLocked,
    #[msg("Account engine mismatch")]
    EngineMismatch,
    #[msg("Account match mismatch")]
    MatchMismatch,
    #[msg("Namespace does not match request")]
    NamespaceMismatch,
    #[msg("Game id mismatch for namespace config")]
    GameIdMismatch,
    #[msg("Invalid basis points configuration")]
    InvalidBps,
    #[msg("Weights cannot be zero")]
    InvalidWeights,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Router state invalid")]
    InvalidRouterState,
}
