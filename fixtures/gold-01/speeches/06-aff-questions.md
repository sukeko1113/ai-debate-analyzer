# ⑥ Questions from the Affirmative (2 min)

- **担当表上の話者**: A3 (Sara)
- **実際に話す人**: **A2 (Ken)** ← violation **#5** `speaker_role_mismatch`
- **Responder**: N2 (Hana)

> **#5 の設計**: 条項 2.2 の担当表では、⑥ 肯定質疑は 4 人チームなら **A3** が担当する。
> ここでは A2 が名乗って質疑を行う。名乗りは正しく行われる（「My name is Ken」）ので、
> **名乗りの有無ではなく、名乗った名前と担当表の突き合わせ**で検出する必要がある。
>
> 条項 2.2 は、間違ったスピーカーが行った場合、次のスピーチが終わった後に判明すると
> 反則負けになると定めている。ただし本アプリは**候補フラグを立てるだけ**で、
> 判定への反映は人が決める（`JUDGE_LOGIC.md` §3）。

---

**Ken**: Thank you, chairperson. My name is Ken. Ms. Hana, you said we did not prove that students meet visitors. Do you accept that more visitors means more contact overall?

**Hana**: More contact between whom?

**Ken**: Between residents of Meridia and people from other countries.

**Hana**: In shops and hotels, yes. In classrooms, you have not shown it.

**Ken**: Thank you. Second question. You said Solera being larger means it absorbs a surge we cannot. Is that in the white paper?

**Hana**: It is an inference from size.

**Ken**: So it is your reasoning, the same kind you criticised us for.

**Hana**: The difference is that our reasoning does not carry a nine hundred million dollar figure.

**Ken**: Thank you. Third question. Doctor Alvarez. What is Doctor Alvarez's position?

**Hana**: A doctor working on public health in Meridia.

**Ken**: Which institution?

**Hana**: I gave the name in my speech.

**Ken**: You gave a name. I am asking for the position.

**Hana**: I will let my partner address that.

**Ken**: Thank you. Fourth question. Your outbreak was in 2019. Was Meridia's visa system in place in 2019?

**Hana**: It was.

**Ken**: So the screening you are defending was operating when the outbreak happened.

**Hana**: The health declaration was introduced after it.

**Ken**: But the visa screening itself did not stop it.

**Hana**: Not that one.

**Ken**: Thank you. That is all.
