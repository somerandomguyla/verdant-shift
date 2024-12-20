const { getUserInfo } = require("@replit/repl-auth")
const express = require('express');
const ejs = require('ejs');

const { Client } = require('@replit/object-storage');
const client = new Client();

const app = express();

//functions
async function AccountCreate(req, res, user) {
  let toUpload = user
  toUpload.campaignStage = 1
  toUpload.campaignStageLevel = 1
  toUpload.userLevel = 1
  toUpload.characters = {}
  //turns object into valid json form
  toUpload = JSON.stringify(toUpload, null, 2);
  const { ok, error } = await client.uploadFromText('account-' + user.id + '.json', toUpload)
  if (!ok) {
      res.send("Error creating account")
      console.log("ERR: Account was not created")
      console.log(user)
      console.log(error)
  } else {
    res.send("Account created!")
  }
}

async function AccountExists(req, res, user) {
  //Check for account existance in object storage
  const { ok, value, error } = await client.list();
  if (!ok) {
    res.send("Database Error: Unable to check for account existance. Try again later.")
  }
  return value.some(item => item.name === 'account-' + user.id + '.json')
}

  //Responses
app.get('/', async (req, res) => {
  const user = getUserInfo(req)
  if (user) {
    if (await AccountExists()) {
    console.log(await AccountExists())
    res.send("Hello " + user.name)
    } else {
      res.render("main-noaccount.ejs", {user: user})
    }
  } else {
    res.redirect("/login")
  }
});

app.get('/createaccount', async (req, res) => {
  // Check for replit login
  const user = getUserInfo(req)
  if (user) {
    const AccountExistTest = await AccountExists(req, res, user)
    if (AccountExistTest) {
      // If account exists, go to home page
        res.redirect("/")
    } else {
      //If account doesn't exist, create it
      AccountCreate(req, res, user)
    }
  } else {
    res.redirect("/login")
  }
});

app.get('/login', async (req, res) => {
  const user = getUserInfo(req)
  if (user) {
    res.redirect('/createaccount');
  } else {
    res.sendFile(__dirname + "/login.html")
  }
});

app.listen(3000, () => {
  console.log('PichuGame active');
});