import { pool } from "../db/dbConnection";

export class Lobbies {
    static async create(round_id: number, result: any) {
        const query = "insert into lobbies (round_id, result) values (?,?)";
        const [insertId]: any = await pool.execute(query, [round_id, JSON.stringify(result)]);
        return insertId;
    }
    static async loadPrevThree() {
        const query = "select round_id, result from lobbies order by created_at desc limit 3";
        const [data] = await pool.query(query);
        return data;
    }
}