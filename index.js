//const { getUserInfo } = require("@replit/repl-auth");
//New crypto package to replace replit & generate session IDs
const crypto = require("crypto")
//Dependencies to run server and render pages, etc.
const express = require("express");
const ejs = require("ejs");
const cookieParser = require("cookie-parser");
const fs = require("fs");

//game logic package
const gameLogic = require("./gamelogic")

const validator = require("validator")
const zod = require("zod")
const DOMPurify = require("dompurify") //probably not required

//Storage package
const { Client } = require("@replit/object-storage");
const path = require("path");
const { error } = require("console");
const { EventEmitterAsyncResource } = require("events");
const client = new Client();

const app = express();
app.use("/static", express.static(path.join(__dirname, "static")));
app.use(express.json());
app.use(cookieParser())

//functions
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

async function getUserInfo(req) {
  if (req.cookies.sessionId) {
    const userInfo = JSON.parse(await getFile(`account-${req.cookies.sessionId}.json`))
    if (!userInfo) return false;
    return userInfo;
  } else {
    return false
  }
}

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
    res.redirect("/welcome");
  }
}

function logout(req, res) {
  if (res && req) {
    res.clearCookie("sessionId")
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
          "Unable to reach account database. Try again later.",
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
        "Unable to reach account database. Try again later.",
      );
      return false;
    }
  } else {
    return JSON.parse(textValue);
  }
}

function statsHandler(heroid, selectedStat, level) {
  if (["defense", "base_attack", "hp", "skill_attack", "critChance"].includes(selectedStat) && Number.isInteger(Number(level)) && Number(level) >= 1 && Number(level) <= 100 && typeof Number(heroid) === "number" && characterNames[heroid]) {
    if (["base_attack", "skill_attack"].includes(selectedStat)) {
    return gameLogic.calculateStats(characterNames[heroid][selectedStat].base_dmg, gameLogic.statCapMultiplier.attack, level)
    } else {
      return gameLogic.calculateStats(characterNames[heroid]["base_stats"][selectedStat], gameLogic.statCapMultiplier[selectedStat], level)
    } 
  } else {
    return false
  }
}

async function giveCoins(id, coins) {
  let userData = await getFile("account-" + id + ".json")
  if (!userData) return console.warn("ERROR: failed to assign coins to " + id)
  userData = JSON.parse(userData)
  userData.coins = userData.coins + coins
  const { ok, error } = await client.uploadFromText('account-' + id + '.json', JSON.stringify(userData));
  if (!ok) {
      return console.warn("ERROR: failed to assign coins: " + error)
  }
  console.log(`Successfully assigned ${coins} coins to ${id}. User now has ${userData.coins} coins.`)
}

async function progressCampaign(id) {
  let userData = await getFile("account-" + id + ".json")
  if (!userData) return console.warn("ERROR: failed to progress campaign for " + id)
  userData = JSON.parse(userData)
  if (userData.campaignStageLevel === 7) {
    if (userData.campaignStage === 4) {
      console.log(id + " reached the last campaign level. Congrats!")
      return true
    } else {
      userData.campaignStage++
      userData.campaignStageLevel = 1
    }
  } else {
    userData.campaignStageLevel++
  }
  console.log(userData.campaignStage + " " + userData.campaignStageLevel)
  const { ok, error } = await client.uploadFromText('account-' + id +'.json', JSON.stringify(userData));
  if (!ok) {
      console.log("failed to progress " + id + " to stage " + userData.campaignStage + " level " + userData.campaignStageLevel)
      return false
  }
  console.log("successfully progressed " + id + " to stage " + userData.campaignStage + " level " + userData.campaignStageLevel)
  return true
}

async function heroLevel(user, hero, num, isSkill) {
  const userData = JSON.parse(await getFile(`account-${user}.json`))
  if (!userData) return false;
  const heroIndex = userData.characters.findIndex(eee => eee.id == hero)
  if (heroIndex === -1) {
    console.log("heroIndex not found")
    return false;
  }
  if (isSkill) {
    userData.characters[heroIndex].skill_level = userData.characters[heroIndex].skill_level + num
    userData.coins = userData.coins - (2000*num)
  } else {
  userData.characters[heroIndex].level = userData.characters[heroIndex].level + num
    userData.coins = userData.coins - (1000*num)
  }
  if (userData.coins < 0) {
    console.log("Not enough coins")
    return false
  }
  if (typeof userData.characters[heroIndex].level === "number") {
    const { ok, error } = await client.uploadFromText('account-' + user + '.json', JSON.stringify(userData));
    if (!ok) {
        console.log("Hero level upgrade fail")
        console.log(error)
      return false;
    }
    return true;
  } else {
    console.log("level NaN")
    return false;
  }
}

const shopPrices = {gray: 15000, blue: 75000, purple: 150000, gold: 250000, verdant: 500000}

async function purchaseHandler(user, shard, num) {
  const userData = JSON.parse(await getFile(`account-${user}.json`))
  if (!userData) return false;
  if (!['gray', 'blue', 'purple', 'gold', 'verdant'].includes(shard)) return false;
  const cost = shopPrices[shard]
    userData.coins = userData.coins - (cost*num)
  userData.summonShards[shard] = userData.summonShards[shard] + num
  if (userData.coins < 0) return false
  if (typeof userData.summonShards[shard] === "number") {
    const { ok, error } = await client.uploadFromText('account-' + user + '.json', JSON.stringify(userData));
    if (!ok) {
        console.log("shard purchase fail")
        console.log(error)
      return false;
    }
    return true;
  } else {
    console.log("shard amount NaN")
    return false;
  }
}

const activeGames = []
class campaignInstance {
  constructor(userid, stage, level, heroes) {
    this.user = userid
    this.campaignInfo = {stage: stage, level: level, stageName: campaignNames[stage].name, levelName: campaignNames[stage][level]}
    let enemies = []
    campaignLevels[stage][level].enemies.forEach(enemy => {
      let stats = {}
      for (const [stat, value] of Object.entries(campaignLevels.default_stats)) {
        stats[stat] = Math.floor(value * campaignLevels.difficulty_multipliers[enemy.difficulty])
        if (stat == "skill_attack") {
          //unused, individual leveling for enemies
        } else {
          //unused, individual leveling for enemies
        }
      }
      enemies.push({stats: stats, id: enemy.id, alive: true, skillCD: 0, name: campaignEnemies[enemy.id.toString()].name})
    })
    this.enemies = enemies
    let gameHeroes = []
    heroes.forEach(hero => {
      let statsBegin = characterNames[hero.id].base_stats
      statsBegin.base_attack = characterNames[hero.id].base_attack.base_dmg
      statsBegin.skill_attack = characterNames[hero.id].skill_attack.base_dmg
      let stats = {}
      for (const [stat, value] of Object.entries(statsBegin)) {
        if (stat == "skill_attack") {
          stats[stat] = Math.floor(statsHandler(hero.id, stat, hero.skill_level))
        } else {
        stats[stat] = Math.floor(statsHandler(hero.id, stat, hero.level))
        }
      }
      gameHeroes.push({id: hero.id, stats: stats, alive: true, skillCD: 0})
    })
    this.heroes = gameHeroes
    this.instanceID = this.generateCampaignInstanceID(userid, stage, level)
    this.coinReward = 0
  }

  generateCampaignInstanceID(userId, campaign, level) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `${userId}-C${campaign}-L${level}-${timestamp}-${random}`;
  }

  manageAttack(hero, target, isSkill) {
    if (this.heroes[hero].alive && this.enemies[target].alive) {
      if (isSkill) {
        if (this.heroes[hero].skillCD === 0) {
          const damage = gameLogic.finalDamage(this.heroes[hero].stats.skill_attack, this.enemies[target].stats.defense, this.heroes[hero].stats.critChance, 0.2)
          const trueDamage = Math.floor(damage[0])
          this.enemies[target].stats.hp = this.enemies[target].stats.hp - trueDamage
          let hasDied = false
          if (this.enemies[target].stats.hp <= 0) {
            this.enemies[target].alive = false;
            hasDied = true
          }
          this.heroes[hero].skillCD === 3
          this.reduceHeroSkillCD()
          const newCoins = trueDamage * 5
          this.coinReward = this.coinReward + newCoins
          return {success: true, damage: trueDamage, isCrit: damage[1], rawDamage: damage[0], isDead: hasDied}
        } else {
          return {success: false, error: `This hero is on skill cooldown. Please try again in ${this.heroes[hero].skillCD - 1} turns.`}
        }
      } else {
        //base attack. Slightly less randomness in damage.
        const damage = gameLogic.finalDamage(this.heroes[hero].stats.base_attack, this.enemies[target].stats.defense, this.heroes[hero].stats.critChance, 0.15)
        const trueDamage = Math.floor(damage[0])
        this.enemies[target].stats.hp = this.enemies[target].stats.hp - trueDamage
        let hasDied = false
        if (this.enemies[target].stats.hp <= 0) {
          this.enemies[target].alive = false;
          hasDied = true
        }
        this.reduceHeroSkillCD()
        const newCoins = trueDamage * 5
        this.coinReward = this.coinReward + newCoins
        return {success: true, damage: trueDamage, isCrit: damage[1], rawDamage: damage[0], isDead: hasDied}
      }
    } else {
      return {success: false, error: "Invalid hero or target. They may be dead."}
    }
  }

  manageEnemyAttack() {
    let aliveEnemies = []
    this.enemies.forEach(enemy => {
      if (enemy.alive) {
        aliveEnemies.push(enemy)
      }
    })
    let aliveHeroes = []
    this.heroes.forEach(hero => {
      if (hero.alive) {
        aliveHeroes.push(hero)
      }
    })
    const aggressorAliveIndex = Math.floor(Math.random() * aliveEnemies.length)
    const aggressor = aliveEnemies[aggressorAliveIndex]
    const aggressorRealIndex = this.enemies.indexOf(aggressor)
    if (aggressorRealIndex === -1) {
      return {success: false, error: "Could not find real index of aggressor"}
    }

    const targetAliveIndex = Math.floor(Math.random() * aliveHeroes.length)
    const target = aliveHeroes[targetAliveIndex]
    const targetRealIndex = this.heroes.indexOf(target)
    if (targetRealIndex === -1) {
      return {success: false, error: "Could not find real index of target"}
    }

    let damage = 0
    let isSkill = false
    if (aggressor.skillCD === 0) {
      //auto skill attack
      isSkill = true
      damage = gameLogic.finalDamage(this.enemies[aggressorRealIndex].stats.skill_attack, this.heroes[targetRealIndex].stats.defense, this.enemies[aggressorRealIndex].stats.critChance, 0.2)
       this.enemies[aggressorRealIndex].skillCD = 3 //1 higher than normal because all enemies have CD reduced immediately after
    } else {
      //auto base attack
      damage = gameLogic.finalDamage(this.enemies[aggressorRealIndex].stats.base_attack, this.heroes[targetRealIndex].stats.defense, this.enemies[aggressorRealIndex].stats.critChance, 0.15)
    }
    const trueDamage = Math.floor(damage[0])
    this.heroes[targetRealIndex].stats.hp = this.heroes[targetRealIndex].stats.hp - trueDamage
    let hasDied = false
    console.log(this.heroes[targetRealIndex].stats.hp)
    if (this.heroes[targetRealIndex].stats.hp <= 0) {
      this.heroes[targetRealIndex].alive = false;
      hasDied = true
    }
    this.reduceEnemySkillCD()
    return {success: true, damage: trueDamage, isCrit: damage[1], rawDamage: damage[0], aggressor: aggressorRealIndex, target: targetRealIndex, isDead: hasDied, isSkill: isSkill}
  }

  reduceEnemySkillCD() {
    this.enemies.forEach(enemy => {
      if (enemy.skillCD > 0) {
        enemy.skillCD--
      }
    })
  }

  reduceHeroSkillCD() {
    this.heroes.forEach(hero => {
      if (hero.skillCD > 0) {
        hero.skillCD--
      }
    })
  }

  checkForGameEnd() {
    if (!this.enemies.some(enemy => enemy.alive)) {
      return [true, true] //game over, won
    } else if (!this.heroes.some(hero => hero.alive)) {
      return [true, false] //game over, lost
    } else {
      return [false, false] //game not over
    }
  }
}

//Responses
app.get("/", async (req, res) => {
  const user = await getUserInfo(req);
  const doRun = await runChecks(req, res, user);
  if (!doRun) {
    return; //
  }
  const userData = JSON.parse(await getFile("account-" + user.id + ".json"))
  if (!userData) return;
    if (await AccountExists(req, res, user)) {
      if (userData.name == "somerandomguyla") {
        res.render("home.ejs", {
          username: userData.name,
          adminbutton: "<button onclick='admin()' class='mini-button'>Admin Lookup</button>",
          adminfunction:
            "function admin() {window.location = '/admin/checkaccount'}",
        });
      } else {
        res.render("home.ejs", {
          username: userData.name,
          adminbutton: null,
          adminfunction: null,
        });
      }
    } else {
      res.render("main-noaccount.ejs", { user: user });
    }
});

app.get("/createaccount", async (req, res) => {
  const user = await getUserInfo(req)
  if (user) {
    res.redirect("/")
    return;
  }
  const { uBox } = req.query
  console.log(uBox)
  if (!uBox) return res.redirect("/login")
  const pattern = /^[a-zA-Z0-9_]+$/;
  if (!pattern.test(uBox) || uBox.length < 3 || uBox.length > 16 || uBox == "somerandomguyla") {
    res.render("errors/redirect.ejs", {errorMessage: "This is not a valid username. Make sure it is between 3-16 characters and does not contain spaces or special characters other than an underscore.", redirect: "/login"})
    return;
  }
  const session = crypto.randomBytes(16).toString('hex');
  res.cookie('sessionId', session, {httpOnly: true, secure: true})
  await AccountCreate(req, res, {name: uBox, id: session})
});

app.get("/login", async (req, res) => {
  const user = await getUserInfo(req);
  if (user) {
    res.redirect("/createaccount");
  } else {
    res.sendFile(__dirname + "/login.html");
  }
});

app.get("/deleteaccount", async (req, res) => {
  const user = await getUserInfo(req);
  console.log("made it")
  const doRun = await runChecks(req, res, user)
  if (!doRun) return;
  console.log("made it")
  const userData = JSON.parse(await getFile("account-" + user.id + ".json"))
  if (!userData) return res.send("Error. Try again later.")
    res.render("account-deleteconfirm.ejs", { accountname: userData.name });
});

app.get("/deleteaccount-confirm", async (req, res) => {
  const user = await getUserInfo(req);
  if (!user) {
    res.redirect("/login");
  } else {
    DeleteAccount(req, res, user);
  }
});

app.get("/logout", async (req, res) => {
  const user = await getUserInfo(req);
  if (!user) return res.redirect("/login")
  res.render("logout-confirm.ejs", {sessionID: user.id, username: user.name})
});

app.get("/logout-confirm", async (req, res) => {
  const user = await getUserInfo(req);
  if (!user) return res.redirect("/login")
  logout(req, res)
  res.redirect("/")
});

app.get("/recover", async (req, res) => {
  const user = await getUserInfo(req)
  if (user) return res.redirect("/")
  if (req.cookies.instantLogin) {
    const instantLogin = req.cookies.instantLogin
    if (AccountExists(req, res, instantLogin)) {
      res.cookie('sessionId', instantLogin, {httpOnly: true, secure: true})
      res.render('errors/redirect.ejs', {errorMessage: "Success! You are now logged in. ", redirect: "/"})
    } else {
      res.render('errors/redirect.ejs', {errorMessage: "You don't have a valid session ID to recover.", redirect: "/login"})
    }
  } else {
    res.render('errors/redirect.ejs', {errorMessage: "You don't have a valid session ID to recover.", redirect: "/login"})
  }
})

app.get("/admin/checkaccount", async (req, res) => {
  const user = await getUserInfo(req);
  const userData = JSON.parse(await getFile("account-" + user.id + ".json"))
  if (user) {
    if (userData.name == "somerandomguyla") {
      if (req.query) {
        const win = new URLSearchParams(req.query);
        const userSearch = win.get("user");
        const toUpload = await userLookup(req, res, user, userSearch);
        res.render("account-lookup.ejs", { user: toUpload });
      } else {
        res.render("account-lookup.ejs", { user: "unknown" });
      }
    } else {
      res.redirect("/")
    }
  } else {
    res.redirect("/");
  }
});

app.get("/play/intro", async (req, res) => {
  const user = await getUserInfo(req);
  if (!(await runChecks(req, res, user))) {
    return; //
  } else {
    res.sendFile(__dirname + "/game-intro.html");
  }
});

app.get("/play/:load*", async (req, res) => {
  const user = await getUserInfo(req);
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
  const user = await getUserInfo(req)
  const doRun = await runChecks(req, res, user)
  if (!doRun) {
    return
  }
  const userData = JSON.parse(await getFile("account-" + user.id + ".json"))
  if (!userData) {
    res.send("Error: could not get user info. Try again later.")
    return
  }
  let toSend = Object.entries(campaignNames)
  toSend = toSend.slice(0, userData.campaignStage)
  res.send([toSend, userData.campaignStageLevel])
})

app.get('/menudata', async (req, res) => {
  const user = await getUserInfo(req)
  const doRun = runChecks(req, res, user)
  if (!doRun) {
    return //
  }
  const userData = JSON.parse(await getFile("account-" + user.id + ".json"))
  if (!userData) {
    res.send("Error: could not get user info. Try again later.")
    return
  }
  res.send({"heroes": userData.characters, "learningsets": null, "summoning": [userData.summonShards, summonPool], "coins": userData.coins})
})

app.post('/summon', async (req, res) => {
  const user = await getUserInfo(req)
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
    toUpload.characters.push({id: summon, level: 1, xp: 0, skill_level: 1, skill_xp: 0, stars: characterNames[summon].base_stars, name: characterNames[summon].name, stats: characterNames[summon].base_stats, attacks: {base: characterNames[summon].base_attack.base_dmg, skill: characterNames[summon].skill_attack.base_dmg}})
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
  
  let toSend = statsHandler(heroid, selectedStat, level, true)
  
  if(!toSend) {
    res.status(400).send("This request is malformed.")
  }

  if (toSend.length == 2) {
    res.send(`${toSend[0]} (${toSend[1]})`)
  } else {
    res.send(toSend)
  }
})

app.get("/campaign/:stage/:level", async (req, res) => {
  const user = await getUserInfo(req)
  const doRun = await runChecks(req, res, user)
  if (!doRun) return;
  const userData = await getAccount(req, res, user)
  if (!userData) return;
  const stage = req.params.stage;
  const level = req.params.level;
  if (stage && level && Number.isInteger(Number(stage)) && Number.isInteger(Number(level)) && campaignNames[stage][level]) {
    if (userData.campaignStage > stage || (userData.campaignStage == stage && userData.campaignStageLevel >= level)) {
    let enemies = []
    campaignLevels[stage][level].enemies.forEach(enemy => {
      enemy.name = campaignEnemies[enemy.id].name
      enemies.push(enemy)
    })
    const toSend = {stage:{stage: campaignNames[stage].name, level: campaignNames[stage][level], num: level}, sentInfo: {enemies: enemies, characters: userData.characters}, maxCharacters: campaignLevels[stage][level].maxCharacters, postGameInfo: campaignLevels[stage][level].lore}
    res.render("game/campaign.ejs", toSend)
    } else {
      res.render("errors/redirect.ejs", {errorMessage: "You haven't unlocked that level yet.", redirect: "/play/campaign"})
    }
  } else {
    res.send("this request is invalid.")
  }
})

  app.post('/startcampaign', async (req, res) => {
    const user = await getUserInfo(req)
    const doRun = await runChecks(req, res, user)
    if (!doRun) return;
    const userData = await getAccount(req, res, user)
    if (!userData) return;
    const info = req.body
    if (Number.isInteger(Number(info.stage)) && (info.stage > userData.campaignStage || (userData.campaignStage > info.stage || (userData.campaignStage == info.stage && userData.campaignStageLevel >= info.level)) && Number.isInteger(Number(info.level)))) {
      let realHeroes = []
      for (const hero of info.heroes) {
        let eeee = hero
        const heroIndex = userData.characters.findIndex(item => item.id === hero.id);
        if (heroIndex === -1) {
          realHeroes = false;
          break
        }
        eeee.level = userData.characters[heroIndex].level
        eeee.skill_level = userData.characters[heroIndex].skill_level
        realHeroes.push(eeee)
      }
      if (!realHeroes) {res.status(400).send("You don't own one of your selected heroes.")}
      if (activeGames.some(game => game.user === user.id)) {
        res.status(400).send({gameStart: false, error: "You already have an active game."})
      } else {
    const data = new campaignInstance(user.id, info.stage, info.level, realHeroes)
        //bugfix to prevent enemy name undefined
        let gameEnemies = data.enemies.map((enemy, index) => {
          return {
            id: enemy.id,
            name: enemy.name,
            stats: enemy.stats,
            difficulty: campaignLevels[info.stage][info.level].enemies[index].difficulty,
            level: campaignLevels[info.stage][info.level].enemies[index].level
          }
        })
        let gameHeroes = []
        for (let i = 0; i < realHeroes.length; i++) {
          let hh = realHeroes[i];
          hh.stats = data.heroes[data.heroes.findIndex(sHero => sHero.id === hh.id)].stats;
          delete hh.attacks
          if (!hh.stats) {
            gameHeroes = false;
            break;
          }
          gameHeroes.push(hh)
        }
        activeGames.push(data)
        res.send({gameStart: true, realHeroes: gameHeroes, realEnemies: gameEnemies})
      }
    } else {
      res.send("This request is invalid.")
    }
  })

app.post('/campaignhandler', async (req, res) => {
  const user = await getUserInfo(req)
  const doRun = await runChecks(req, res, user)
  if (!doRun) return;
  const userData = await getAccount(req, res, user)
  if (!userData) return; //edge case, likely not possible
  const info = req.body
  if (activeGames.some(game => game.user === user.id)) {
  if (info.type) {
    const gameData = activeGames[activeGames.findIndex(game => game.user === user.id)]
    if (info.type === "attack") {
      //attack
     const attackData = gameData.manageAttack(info.hero, info.target, info.isSkill)
      if (!attackData.success) return res.send({success: false, error: attackData.error})

      //check for game end
      let gameOver = gameData.checkForGameEnd()

      //enemy attack
      if (!gameOver[0]) {
      let responseData
    responseData = gameData.manageEnemyAttack()
      if  (!responseData.success) return res.send({success: false, error: responseData.error})

      gameOver = gameData.checkForGameEnd()
      if (gameOver[0]) {
        responseData.gameOver = gameOver[0]
        responseData.clientWin = gameOver[1]
        responseData.coinReward = activeGames[activeGames.findIndex(game => game.user === user.id)].coinReward
        activeGames.splice(activeGames.findIndex(game => game.user === user.id), 1)
        await giveCoins(user.id, responseData.coinReward)
        res.send({success: true, attack: attackData, response: responseData})
      } else {
      res.send({success: true, attack: attackData, response: responseData})
      }
      } else {
        let coinReward = activeGames[activeGames.findIndex(game => game.user === user.id)].coinReward
        let progressed = true
        if (gameData.campaignInfo.stage == userData.campaignStage && gameData.campaignInfo.level == userData.campaignStageLevel) {
          coinReward = coinReward * 1.5
          coinReward = Math.floor(coinReward)
          progressed = await progressCampaign(user.id)
        }
        activeGames.splice(activeGames.findIndex(game => game.user === user.id), 1)
        console.log(coinReward + " " + typeof coinReward)
        await giveCoins(user.id, coinReward)
        res.send({success: true, attack: attackData, response: {success: false, gameOver: gameOver[0], clientWin: gameOver[1], coinReward: coinReward, progressed: progressed}})
      }
      
    } else if (info.type === "forfeit") {
      //forfeit handler
      activeGames.splice(activeGames.findIndex(game => {game.user === user.id}), 1)
      res.send({success: true, coins: gameData.coinReward})
      await giveCoins(user.id, gameData.coinReward)
      
    } else if (info.type === "recover") {
      //data recovery, ie page closed
      res.status(400).send("Recovery feature unavailable")
      
    } else {
      res.status(400).send("Unknown interaction type")
    }
  } else {
    res.status(400).send("Invalid request")
  }
  } else {
    res.status(400).send("No active game found")
  }
})

app.post('/levelinghandler', async (req, res) => {
  const user = await getUserInfo(req)
  const doRun = await runChecks(req, res, user)
  if (!doRun) return;
  const userData = JSON.parse(await getFile('account-' + user.id + '.json'))
  if (!userData) return;
  const data = req.body
  console.log(typeof data.num)
  if (typeof data.num == "number") {
    console.log("success 1")
    console.log(data.hero)
    if (userData.characters.some(hero => hero.id == data.hero)) {
      console.log("success 2")
      const levelup = heroLevel(user.id, data.hero, data.num, data.isSkill)
      if (levelup) {
        res.send({success: true})
      } else {
        res.send({success: false})
      }
    } else {
      res.status(400).send("Bad request, likely unobtained hero")
    }
  } else {
    res.status(400).send("Bad request")
  }
})

app.post('/shophandler', async (req, res) => {
  const user = await getUserInfo(req)
  const doRun = await runChecks(req, res, user)
  if (!doRun) return;
  const userData = JSON.parse(await getFile('account-' + user.id + '.json'))
  if (!userData) return;
  const data = req.body
  if (typeof data.amount == "number" && ['gray', 'blue', 'purple', 'gold', 'verdant'].includes(data.shard)) {
      const purchase = await purchaseHandler(user.id, data.shard, data.amount)
      if (purchase) {
        res.send({success: true})
      } else {
        res.send({success: false})
      }
  } else {
    res.status(400).send("Bad request")
  }
})

app.get('/settings', async (req, res) => {
  const user = await getUserInfo(req)
  const doRun = await runChecks(req, res, user)
  if (!doRun) return;
  res.render('settings.ejs', {session: user.id})
})

app.get("/eee", (req, res) => {
  res.render("errors/redirect.ejs", {errorMessage: "This information is coming soon!", redirect: "/play/main"})
})

app.get("/credits", (req, res) => {
  res.sendFile(__dirname + "/static/credits.html")
})

app.get("/source", (req, res) => {
  res.redirect("https://github.com/somerandomguyla/verdant-shift")
})

app.get("/extras", async (req, res) => {
  const user = await getUserInfo(req)
  const doRun = await runChecks(req, res, user)
  if (!doRun) return;
  res.sendFile(__dirname + "/extras.html")
})

app.get("/welcome", async (req, res) => {
  const user = await getUserInfo(req)
  const doRun = await runChecks(req, res, user)
  if (!doRun) return;
  res.sendFile(__dirname + "/welcome.html")
})

app.get("/favicon.ico", (req, res) => {
  res.sendFile(__dirname + "/static/favicon.jpg")
})

app.use((req, res, next) => {
  res.status(404).sendFile(__dirname + "/views/errors/404.html");
});

//Manual upload to App Storage
/*(async () => {
  const toUpload = ""
  const toUploadLocation = "";
  const { ok } = await client.uploadFromText(
    toUploadLocation,
    JSON.stringify(toUpload, null, 2)
  );
  if (!ok) console.log("Upload failed");
})();*/
  
let campaignNames;
let summonPool;
let characterNames;
let campaignLevels;
let campaignEnemies;

app.listen(5000, async () => {
  console.log("Verdant Shift active");
  campaignNames = JSON.parse(await getFile("campaignNames.json"));
  summonPool = JSON.parse(await getFile("summonPool.json"));

  try {
    const data = fs.readFileSync('./gameinfo/campaignlevels.json', 'utf8');
    campaignLevels = JSON.parse(data);
    const data2 = fs.readFileSync("./gameinfo/campaignenemies.json")
    campaignEnemies = JSON.parse(data2)
    const data3 = fs.readFileSync("./gameinfo/character-names.json")
    characterNames = JSON.parse(data3)
    console.log('Stored data loaded');
  } catch (err) {
    console.error('Error reading stored data:', err);
    process.exit(1);
  }
});