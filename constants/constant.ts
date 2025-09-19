import type { IGameSettings } from "../interfaces";

export const GAME_SETTINGS: IGameSettings = {
    max_amt: 200000,
    min_amt: 25,
    max_co: 1000000,
    main_mult: {
        PLAYER_A: 1.98,
        PLAYER_B: 1.98,
    },
    side_mult: {
        PAIR: 2,
        FLUSH: 5,
        STRAIGHT: 7,
        STRAIGHT_FLUSH: 36,
        TRIO: 46
    }
}

