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
        PAIR: 1,
        FLUSH: 4,
        STRAIGHT: 6,
        STRAIGHT_FLUSH: 35,
        TRIO: 45
    }

}

