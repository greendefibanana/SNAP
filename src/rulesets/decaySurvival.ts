import { applyTokenBurnGuards } from '../rules/tokenBurnGuard.js';
import type { SnapAction, SnapManifest, SnapRuleset, SnapState } from '../engine/types.js';

function forceMintToken(state: SnapState, action: SnapAction, to: string, amount: number): SnapState {
    const tokenization = state.modules.tokenization as any;
    if (!tokenization) return state;

    const ftBalances = tokenization.ftBalances || {};
    const classBalances = ftBalances['magazine-ft'] || {};
    classBalances[to] = Number(classBalances[to] || 0) + amount;

    return {
        ...state,
        modules: {
            ...state.modules,
            tokenization: {
                ...tokenization,
                ftBalances: {
                    ...ftBalances,
                    ['magazine-ft']: classBalances
                }
            }
        }
    };
}

export const decaySurvivalRuleset: SnapRuleset = {
    id: 'decay-survival',
    createInitialState(manifest: SnapManifest): SnapState {
        const matchId = String(manifest.ruleVars?.matchId?.value || 'snap-match');
        return {
            matchId,
            phase: 'PREMATCH',
            seq: 0,
            stateHash: '',
            ruleVars: { ...(manifest.ruleVars ?? {}) },
            modules: {},
            custom: {
                decaySurvival: {
                    killsByPlayer: {},
                    hasMintedInitialMags: {},
                }
            },
        };
    },
    reduce(inputState: SnapState, action: SnapAction, manifest: SnapManifest): SnapState {
        let state = inputState;

        // 1. Enforce burn of 1 FT magazine for reloading
        state = applyTokenBurnGuards(state, action, {
            requirements: [
                { actionKind: 'RELOAD', classId: 'magazine-ft', amount: 1, errorMessage: 'Out of magazines! Hit 10 kills or use more tokens!' },
            ],
        });

        const actor = action.actor;
        if (actor && actor !== 'ruleset:decay-survival') {
            if (!state.custom.decaySurvival) {
                state.custom.decaySurvival = { killsByPlayer: {}, hasMintedInitialMags: {} };
            }
            const custom = state.custom.decaySurvival as any;

            // 2. Initial Mint of 10 magazines on first interaction (e.g. initial connection)
            if (!custom.hasMintedInitialMags[actor]) {
                custom.hasMintedInitialMags[actor] = true;
                state = forceMintToken(state, action, actor, 10);
            }

            // 3. 1 Mag per 10 kills
            if (action.kind === 'SCORE_ADD') {
                const delta = Number((action.payload as any)?.delta || 0);
                if (delta > 0) {
                    const currentKills = custom.killsByPlayer[actor] || 0;
                    const nextKills = currentKills + delta;

                    const magsEarnedNow = Math.floor(nextKills / 10);
                    const magsEarnedBefore = Math.floor(currentKills / 10);
                    const newMags = magsEarnedNow - magsEarnedBefore;

                    custom.killsByPlayer[actor] = nextKills;

                    if (newMags > 0) {
                        state = forceMintToken(state, action, actor, newMags);
                    }
                }
            }
        }

        return state;
    },
};
