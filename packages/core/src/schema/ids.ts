/**
 * id の型。DATA_MODEL.md の全テーブルが uuid を PK にしているので、
 * ドメインスキーマ側も uuid で受ける。
 *
 * id は必ずサーバが割り当てる。AI にもクライアントにも生成させない
 * （JUDGE_LOGIC.md §2）。ここで uuid を要求するのは、その約束を
 * 「それらしい文字列」で通り抜けられなくするためである。
 */
import { z } from "zod";

export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;
