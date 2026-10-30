"use strict";
const quests = [
  { id: "hunt", name: "Trail of Echoes", goal: 3, coins: 300 },
  { id: "cf", name: "Faces of Fate", goal: 3, coins: 200 },
  { id: "battle", name: "Hold the Rift", goal: 2, coins: 400 },
];
function advance(game, user, action) {
  const kind = action === "boss" ? "battle" : action;
  const quest = quests.find((q) => q.id === kind);
  if (!quest) return;
  const day = Math.floor(game.clock() / 86400000);
  game
    .sql(
      "INSERT INTO quest_progress(user,day,kind,progress) VALUES(?,?,?,1) ON CONFLICT(user,day,kind) DO UPDATE SET progress=MIN(?,progress+1)",
    )
    .run(user, day, kind, quest.goal);
}
module.exports = { quests, advance };
