# ⑨ Affirmative Defense (3 min)

- **Speaker**: A3 (Sara)
- **Target**: 約 420 words（3分で 140 wpm）＋ **ベル後の 45 words**
- **Planted**: violation **#9** `over_time`

> **#9 の設計**: 条項 2.2.3 は、時間終了時に「発言している最後の文を終えること」は許すが、
> **終了後 10 秒を超えて発言することは一切許さない**と定める。
> ここでは、ベルの後に **約15秒（45語）** 話し続ける。
>
> **検出には時刻が要る。** 原稿だけでは検出できない。
> `stage_segments.end_ms` を基準に、そこから 10 秒を超えた `transcript_segments` を
> 判定対象外の候補にする。**Pass C のアンカー照合が正しく効いていないと検出できない**ため、
> このフラグは時刻精度の間接的な検査にもなる。
>
> 音声を組み立てるとき、ベルの位置は **3分00秒ちょうど**に置く。
> `over_time` の対象は `[BELL]` 以降のすべてである。

> **⑨ の役割上の制約**: 条項 2.1.5 により、ディフェンスは**防御的なスピーチのみ**。
> 新しい Plan・新しい Advantage・否定立論への新しいアタックは禁止。
> ただし「今までの議論の比較をする観点を出すこと」は許される。
> ここでは ⑤ の3つの攻撃に答え、比較の観点だけを出す。

---

Thank you, chairperson. My name is Sara, and I will defend our advantages.

Ms. Hana made three attacks. I take them in order.

Her first attack was on the Solera analogy. She said that if Solera is larger, it absorbs a surge that we cannot. I want you to notice what that argument concedes. It concedes that removing the visa produces a surge. Their own attack assumes our effect is real. What they dispute is the size, not the direction. And on size, the white paper we cited gives a measured figure from a comparable island economy. Ms. Hana gave you no counter figure at all.

Her second attack was on the eight hundred dollar figure. She is right that we did not read out its source, and I will not pretend otherwise. So set it aside. Take the figure we did source: tourism is twelve percent of our national economy. That is from the Tourism Authority. Twelve percent does not depend on the eight hundred dollars. The advantage rests on the share, and the share was cited.

Her third attack was on international exchange. She said there are three unproven steps between arrivals and education. Two of those steps are already happening. Our schools already try to run exchange programmes. Ms. Hana did not contest that they fail because of the three week window. What she disputes is the last step, whether meeting a visitor changes a student. That is a smaller gap than she described.

Now the comparison, which is where this round is decided.

The negative asks you to weigh six weeks of closed schools against money. That is not the comparison. Their six weeks came from an outbreak that happened while the visa system was operating. Ms. Hana accepted in questioning that the visa screening did not stop it. So the choice is not between safety and money. It is between a screening step that already failed once and covers only sixty percent of arrivals, and a measured economic effect in a country that depends on tourism for twelve percent of its economy and for the jobs in villages that are emptying.

We are not asking you to ignore public health. We are asking you to notice that their own evidence shows the screening did not deliver it.

**[BELL — 3:00]**

And one more point before I finish. Even if you accept every word of their health argument, the plan still leaves passport control in place, it still leaves quarantine powers in place, and nothing in their case shows that those two together are insufficient. Thank you.
