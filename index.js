//Authentication package
const { getUserInfo } = require("@replit/repl-auth");
//Dependencies to run server and render pages, etc.
const express = require("express");
const ejs = require("ejs");
const cookieParser = require("cookie-parser");
const fs = require("fs");

//game logic package
const gameLogic = require("./gamelogic")

//prevent XSS attacks by cleansing input & output.
const validator = require("validator")
const zod = require("zod")
const DOMPurify = require("dompurify") //probably not required

//Storage package
const { Client } = require("@replit/object-storage");
const path = require("path");
const { error } = require("console");
const client = new Client();

const app = express();
app.use("/static", express.static(path.join(__dirname, "static")));
app.use(express.json());

//functions
async function AccountCreate(req, res, user) {
  let toUpload = user;
  toUpload.campaignStage = 1;
  toUpload.campaignStageLevel = 1;
  toUpload.userLevel = 1;
  toUpload.userLevelXp = 0;
  toUpload.characters = [{id: 0, level: 1, xp: 0, skill_level: 1, skill_xp: 0, stars: 3, name: "Sylas", stats: characterNames["0"].base_stats, attacks: {base: characterNames["0"].base_attack.base_dmg, skill: characterNames["0"].skill_attack.base_dmg}}];
  toUpload.summonShards = {gray: 1, blue: 0, purple: 0, gold: 0, verdant: 0, spirit: 0};
  toUpload.suspendedData = {
    isSuspended: false,
    "suspended-reason": null,
    "suspended-by": null,
    "suspended-expiration": null,
    "suspended-ID": null,
  };
  toUpload.coins = 1000
  //turns object into valid json form
  toUpload = JSON.stringify(toUpload, null, 2);
  const { ok, error } = await client.uploadFromText(
    "account-" + user.id + ".json",
    toUpload,
  );
  if (!ok) {
    res.send("Error creating account. Try again later.");
    console.error("ERR: Account was not created");
    console.log(user);
    console.log(error);
  } else {
    res.redirect("/");
  }
}

function logout(req, res) {
  if (res && req) {
    res.cookie("REPL_AUTH", "", { domain: "." + req.hostname, maxAge: 2 });
  }
}

async function AccountExists(req, res, user) {
  //Check for account existance in object storage
  const { ok, value, error } = await client.list();
  if (!ok) {
    res.send(
      "Database Error: Unable to check for account existance. Try again later.",
    );
  }
  return value.some((item) => item.name === "account-" + user.id + ".json");
}

async function DeleteAccount(req, res, user) {
  const { ok, error } = await client.delete("account-" + user.id + ".json");
  if (!ok) {
    res.send(
      "Unable to delete account. Try again later or contact an administrator for manual deletion.",
    );
  } else {
    logout(req, res);
    res.redirect("/");
  }
}

async function userLookup(req, res, user, userSearch) {
  const {
    ok,
    value: textValue,
    error,
  } = await client.downloadAsText("account-" + userSearch + ".json");
  if (!ok) {
    return "unknown";
  } else {
    return textValue;
  }
}

async function runChecks(req, res, user) {
  if (!user) {
    res.redirect("/login");
    return false;
  } else {
    const {
      ok,
      value: textValue,
      error,
    } = await client.downloadAsText("account-" + user.id + ".json");
    if (!ok) {
      if (error.message.startsWith("No such object:")) {
        res.redirect("/createaccount");
      } else {
        res.send(
          "Unable to reach account database. Try again later or contact support.",
        );
      }
      return false;
    } else {
      const e = JSON.parse(textValue);
      if (e.suspendedData.isSuspended) {
        res.redirect("/suspended");
        return false;
      }
      return true;
    }
  }
}

async function getFile(fileName) {
  const { ok, value: textValue, error } = await client.downloadAsText(fileName);
  if (!ok) {
    if (error.message.startsWith("No such object:")) {
      console.warn(
        "Error: getFile function searched for a nonexistent object.",
      );
    } else {
      console.warn(
        "Error: getFile function ran into an error while fetching file.",
      );
    }
    return null;
  }
  return textValue;
}

//Separate function for accounts as it returns text to the client.
async function getAccount(req, res, user) {
  const {
    ok,
    value: textValue,
    error,
  } = await client.downloadAsText("account-" + user.id + ".json");
  if (!ok) {
    if (error.message.startsWith("No such object:")) {
      res.redirect("/createaccount");
      return false;
    } else {
      res.send(
        "Unable to reach account database. Try again later or contact support.",
      );
      return false;
    }
  } else {
    return JSON.parse(textValue);
  }
}

//Responses
app.get("/", async (req, res) => {
  const user = getUserInfo(req);
  const doRun = await runChecks(req, res, user);
  if (!doRun) {
    return; //
  }
  if (user) {
    if (await AccountExists(req, res, user)) {
      if (user.id == 15445038) {
        res.render("home.ejs", {
          username: user.name,
          adminbutton: "<button onclick='admin()'>Admin Lookup</button>",
          adminfunction:
            "function admin() {window.location = '/admin/checkaccount'}",
        });
      } else {
        res.render("home.ejs", {
          username: user.name,
          adminbutton: null,
          adminfunction: null,
        });
      }
    } else {
      res.render("main-noaccount.ejs", { user: user });
    }
  } else {
    res.redirect("/login");
  }
});

app.get("/createaccount", async (req, res) => {
  // Check for replit login
  const user = getUserInfo(req);
  if (user) {
    if (await AccountExists(req, res, user)) {
      // If account exists, go to home page
      res.redirect("/");
    } else {
      //If account doesn't exist, create it
      AccountCreate(req, res, user);
    }
  } else {
    // If not logged in, go to login
    res.redirect("/login");
  }
});

app.get("/login", async (req, res) => {
  const user = getUserInfo(req);
  if (user) {
    res.redirect("/createaccount");
  } else {
    res.sendFile(__dirname + "/login.html");
  }
});

app.get("/deleteaccount", (req, res) => {
  const user = getUserInfo(req);
  if (!user) {
    res.redirect("/login");
  } else {
    res.render("account-deleteconfirm.ejs", { accountname: user.name });
  }
});

app.get("/deleteaccount-confirm", (req, res) => {
  const user = getUserInfo(req);
  if (!user) {
    res.redirect("/login");
  } else {
    DeleteAccount(req, res, user);
  }
});

app.get("/logout", (req, res) => {
  const user = getUserInfo(req);
  if (!user) {
    res.redirect("/login");
  } else {
    logout(req, res);
    res.redirect("/login");
  }
});

app.get("/admin/checkaccount", async (req, res) => {
  const user = getUserInfo(req);
  if (user) {
    if (!user.id == "15445038") {
      res.redirect("/");
    } else {
      if (req.query) {
        const win = new URLSearchParams(req.query);
        const userSearch = win.get("user");
        const toUpload = await userLookup(req, res, user, userSearch);
        res.render("account-lookup.ejs", { user: toUpload });
      } else {
        res.render("account-lookup.ejs", { user: "unknown" });
      }
    }
  } else {
    res.redirect("/");
  }
});

app.get("/play/intro", async (req, res) => {
  const user = getUserInfo(req);
  if (!(await runChecks(req, res, user))) {
    return; //
  } else {
    res.sendFile(__dirname + "/game-intro.html");
  }
});

app.get("/play/:load*", async (req, res) => {
  const user = getUserInfo(req);
  if (!(await runChecks(req, res, user))) {
    return; //
  } else {
    const e = req.params.load;
    if (e) {
      if (!(e == "main")) {
        res.render("game/main.ejs", { immediateLoad: "section-" + e, immediateLoadID: e });
        return;
      }
    }
    res.render("game/main.ejs", { immediateLoad: null, immediateLoadID: null });
  }
});

app.get("/campaigndata", async (req, res) => {
  const user = getUserInfo(req)
  const doRun = await runChecks(req, res, user)
  if (!doRun) {
    return
  }
  const userData = JSON.parse(await getFile("account-" + user.id + ".json"))
  if (!userData) {
    res.send("Error: could not get user info. Try again later or contact support.")
    return
  }
  let toSend = Object.entries(campaignNames)
  toSend = toSend.slice(0, userData.campaignStage)
  res.send([toSend, userData.campaignStageLevel])
})

app.get('/menudata', async (req, res) => {
  const user = getUserInfo(req)
  const doRun = runChecks(req, res, user)
  if (!doRun) {
    return //
  }
  const userData = JSON.parse(await getFile("account-" + user.id + ".json"))
  if (!userData) {
    res.send("Error: could not get user info. Try again later or contact support.")
    return
  }
  res.send({"heroes": userData.characters, "learningsets": null, "summoning": [userData.summonShards, summonPool]})
})

app.post('/summon', async (req, res) => {
  const user = getUserInfo(req)
  const doRun = await runChecks(req, res, user)
  if (!doRun) {
    return //error handled
  }
  const { shard, amount } = req.body
  if (!shard || !amount) {
    return res.status(400).send({"ok": false, "error": "Invalid request"})
  }
  const userData = JSON.parse(await getFile("account-" + user.id + ".json"))
  if (userData.summonShards[shard] < amount) {
    return res.send({"ok": false, "error": "Not enough shards"})
  }
  let summoned = []
  for(let i = 0; i < amount; i++){
    const num = Math.ceil(Math.random() * 100)
    let x = 0
    let rarity
    for(let z = 0; z < summonPool[shard+"Shard"].length; z++) {
      x = x + summonPool[shard+"Shard"][z]
      if (num <= x) {
        rarity = z
        break
      }
    }
    const num2 = Math.floor(Math.random() * characterNames.ID_byRarity[rarity].length)
    summoned.push(characterNames.ID_byRarity[rarity][num2])
  }
  let toSend = []
  let toUpload = userData
  let totalCoins = 0
  summoned.forEach((summon) => {
    let q = characterNames[summon]
    q.id = summon
    toSend.push(q)
    if (toUpload.characters.some(character => character.name === characterNames[summon].name)) {
  toUpload.coins = toUpload.coins + characterNames.duplicateCharacterCoins[characterNames[summon].rarity]
      totalCoins = totalCoins + characterNames.duplicateCharacterCoins[characterNames[summon].rarity]
    } else {
    toUpload.characters.push({id: summon, level: 1, xp: 0, skill_level: 1, skill_xp: 0, stars: characterNames[summon].base_stars, name: characterNames[summon].name})
    }
  })
  toUpload.summonShards[shard] = toUpload.summonShards[shard] - amount
  const { ok, error } = await client.uploadFromText('account-' + user.id + '.json', JSON.stringify(toUpload));
  if (!ok) {
      return res.send({"ok": false, "error": "Unable to update account data. No changes have been made and summons have been nullified."})
  }
  res.send({"ok": true, "result": toSend, "coins": totalCoins})
})

app.get('/viewhero/:id', (req, res) => {
  const id = req.params.id
  if (characterNames[id].name) {
    //check to see if character exists and is not just a different file in characterNames, ex. duplicateCharacterCoins.
  res.render("viewhero.ejs", {hero: characterNames[id], attacktypes: ["One Target", "All Opponents", "Two Targets", "Healing"], rarities: ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"]});
  } else {
    res.status(404).sendFile(__dirname + "/views/errors/404.html")
  }
})

app.get("/statshandler/:heroid/:stat/:level", (req, res) => {
  const heroid = req.params.heroid
  const selectedStat = req.params.stat
  const level = req.params.level
  //Random dump of checks to make sure the request is properly formed. Probably could be simpler
  if (["defense", "base_attack", "hp", "skill_attack"].includes(selectedStat) && Number.isInteger(Number(level)) && Number(level) >= 1 && Number(level) <= 100 && typeof Number(heroid) === "number" && characterNames[heroid]) {
    if (["base_attack", "skill_attack"].includes(selectedStat)) {
    res.send(gameLogic.calculateStats(characterNames[heroid][selectedStat].base_dmg, gameLogic.statCapMultiplier.attack, level))
    } else {
      res.send(gameLogic.calculateStats(characterNames[heroid]["base_stats"][selectedStat], gameLogic.statCapMultiplier[selectedStat], level))
    }
  } else {
    res.statusCode(400).send("This request is malformed.")
  }
})



app.use((req, res, next) => {
  res.status(404).sendFile(__dirname + "/views/errors/404.html");
});

let campaignNames;
let summonPool;
let characterNames;

app.listen(5000, async () => {
  console.log("Verdant Shift active");
  campaignNames = JSON.parse(await getFile("campaignNames.json"));
  summonPool = JSON.parse(await getFile("summonPool.json"));
  characterNames = JSON.parse(await getFile("character-names.json"))
});