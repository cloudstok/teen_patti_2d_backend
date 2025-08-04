export interface IUserDetailResponse {
    status: boolean;
    user: {
        user_id: string;
        name: string;
        balance: number;
        operatorId: string;
    };
}

export interface Info {
    urId: string;
    urNm: string;
    bl: number;
    sid: string;
    operatorId: string;
    gmId: string;
    token: string;
    ip: string;
}

/* TRANSACTION INTERFACES */
export interface IPlayerDetails {
    game_id: string;
    operatorId: string;
    token: string;
}

export interface IBetObject {
    id: string;
    bet_amount: number;
    winning_amount?: number;
    game_id: string;
    user_id: string;
    txn_id?: string;
    ip?: string;
}

export interface IWebhookData {
    txn_id: string;
    ip?: string;
    game_id: string;
    user_id: string;
    amount?: number;
    description?: string;
    bet_id?: string;
    txn_type?: number;
    txn_ref_id?: string;
}

// GAME_SETTINGS
export interface IGameSettings {
    min_amt: number;
    max_amt: number;
    max_co: number;
    win_mult: number;

}

export interface ICardInfo {
    card: string;
    suit: string;
    val: number;
}

export interface IRoundResult {
    winner: "PLAYER_A" | "PLAYER_B" | "TIE";
    roundId: number;
    playerACards: ICardInfo[];
    playerBCards: ICardInfo[];
}