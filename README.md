# Orders — Customer & Owner Apps

Two small web apps that share the same orders:

- **Customer app** — people upload their order: a photo, the item name, a
  description, the quantity, their name, and a price they saw (optional).
- **Owner app** — the owner sees **all** uploaded orders in one place, sets a
  status on each one (Looking for it / Found - can buy / Negotiating /
  Not available / Cancelled), records places where the item was found
  (store, location, price, distance — the app marks the **lowest price** and
  the **nearest** store), opens web / map searches for the item, and chats
  with the customer inside each item's own message thread.

Orders are saved on the server, so closing and reopening the app loses
nothing. It is plain Node.js with **no extra packages to install**.

---

## Before you deploy: change the owner passcode

The owner actions (changing a status, adding a price find, deleting an
order) are protected by a passcode.

- Default passcode: `owner123` — **do not keep this.**
- When you deploy (step 3 below), set an environment variable named
  `OWNER_CODE` to your own passcode. That is the passcode you type into the
  Owner app.

Customers never need the passcode. They can upload orders and chat without it.

---

## Deploy it for free on Render (one time, about 10 minutes)

You need a free Render account and this folder uploaded to a free GitHub
account first. If that is new to you, ask whoever helps you with computer
things to do steps 1–2 with you — after that, using the apps is just opening
a link.

1. **Put this folder on GitHub**
   - Go to github.com, sign up / sign in, click **New repository**, name it
     `order-apps`, create it.
   - Upload the files from this folder (`server.js`, `package.json`,
     `README.md`, and the `data` folder) using **uploading an existing file**.

2. **Create the web service on Render**
   - Go to render.com, sign up / sign in, click **New + → Web Service**.
   - Connect your GitHub account and choose the `order-apps` repository.

3. **Fill in the settings**
   - Runtime: **Node**
   - Build Command: leave it empty (there is nothing to install)
   - Start Command: `npm start`
   - Instance type: **Free**
   - Click **Advanced → Add Environment Variable**:
     - Key: `OWNER_CODE`  Value: *(your own passcode — remember it)*

4. **Create the service** and wait until Render shows it as **Live**.
   Render gives you a link like `https://order-apps-xxxx.onrender.com`.

> Note about the free plan: the service sleeps when nobody uses it, so the
> first opening after a quiet period can take about a minute. Also, on the
> free plan the stored orders can be reset when the service is redeployed —
> for everyday use by a small group this is usually fine, and the owner can
> upgrade the instance later if the orders must be kept permanently.

Other hosts work too (Railway, a VPS, your own computer): anywhere Node.js
18 or newer runs, `npm start` is all it takes. The port is taken from the
`PORT` environment variable automatically.

---

## Using the apps on an iPhone

1. Open the link in **Safari**.
   - Customer link: the link itself, e.g. `https://order-apps-xxxx.onrender.com/`
   - Owner link: the same link with `/owner` at the end, e.g.
     `https://order-apps-xxxx.onrender.com/owner`
2. Tap the **Share** button, then **Add to Home Screen**. The app now sits on
   the Home Screen like a normal app.
3. Give customers the customer link (or a QR code of it). Give nobody the
   owner passcode except the owner.

### Owner, first time
Open the Owner app, type your passcode (the `OWNER_CODE` you set) into the
**Owner passcode** box and tap **Save**. You only need to do this once per
browser tab session.

---

## Running it on a computer instead (for trying it out)

```
npm start
```

Then open `http://localhost:3000/` (customer) and
`http://localhost:3000/owner` (owner) in a browser.
The default passcode in this local try-out is `owner123`.

## Where the data lives

- `data/orders.json` — all orders, price finds and chat messages.
- `data/uploads/` — the uploaded photos.

Back up the whole `data` folder to keep a copy of everything.
