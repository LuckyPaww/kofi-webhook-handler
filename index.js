// index.js
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const basicAuth = require('basic-auth'); // Used only for webhook auth now

const app = express();
const PORT = process.env.PORT || 3000;

// Ko-fi verification token
const KOFI_VERIFICATION_TOKEN = process.env.KOFI_VERIFICATION_TOKEN || '92220b03-30f2-441d-87c6-92629540720b';

// Tier information
const TIERS = {
  'Basic': { price: '$10', api: 'No API', messages: 0 },
  'Plus': { price: '$20', api: '$5 API tier', messages: 50 },
  'Platinum': { price: '$30', api: '$10 API tier', messages: 125 },
  'Supporter': { price: '$50', api: '$20 API tier', messages: 300 },
  'Supporter Ultimate': { price: '$100', api: '$40 API tier', messages: 700 }
};

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database file path
const DB_PATH = path.join(__dirname, 'subscribers.json');

// Initialize database if it doesn't exist
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({ subscribers: [] }));
}

// Helper function to read database
function readDatabase() {
  try {
    const data = fs.readFileSync(DB_PATH);
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading database:", error);
    return { subscribers: [] };
  }
}

// Helper function to write to database
function writeDatabase(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Error writing database:", error);
  }
}

// --- START: Webhook Authentication Middleware ---
// Apply this middleware ONLY to the /kofi-webhook route
app.use('/kofi-webhook', (req, res, next) => {
  const credentials = basicAuth(req);
  const requiredUsername = 'admin';
  const requiredPassword = 'jenn';

  if (!credentials || credentials.name !== requiredUsername || credentials.pass !== requiredPassword) {
    console.warn('Webhook authentication failed for IP:', req.ip);
    res.set('WWW-Authenticate', 'Basic realm="Ko-fi Webhook"');
    return res.status(401).send('Authentication Required');
  }
  console.log('Webhook authentication successful');
  next();
});
// --- END: Webhook Authentication Middleware ---

// Ko-fi webhook endpoint
app.post('/kofi-webhook', (req, res) => {
  try {
    if (!req.body || !req.body.data) {
        console.log('Received empty or invalid webhook payload');
        return res.status(200).send('Invalid payload');
    }

    let kofiData;
    try {
      kofiData = JSON.parse(req.body.data);
    } catch (parseError) {
      console.error('Error parsing webhook JSON:', parseError);
      console.error('Raw data:', req.body.data);
      return res.status(200).send('Invalid JSON data');
    }

    console.log('Received webhook:', kofiData);

    if (kofiData.verification_token !== KOFI_VERIFICATION_TOKEN) {
      console.log('Invalid verification token received:', kofiData.verification_token);
      return res.status(200).send('Invalid verification token');
    }

    if (kofiData.type === 'Subscription') {
      const db = readDatabase();
      let subscriber = db.subscribers.find(s => s.email === kofiData.email);

      if (subscriber) {
        subscriber.active = true;
        subscriber.last_payment = kofiData.timestamp || new Date().toISOString();
        subscriber.tier = kofiData.tier_name || subscriber.tier;
        subscriber.amount = kofiData.amount || subscriber.amount;
        subscriber.currency = kofiData.currency || subscriber.currency;
        subscriber.name = kofiData.from_name || subscriber.name;
        console.log(`Subscription updated: ${subscriber.name} to tier ${subscriber.tier}`);
      } else {
        const newSubscriber = {
          kofi_transaction_id: kofiData.kofi_transaction_id,
          email: kofiData.email,
          name: kofiData.from_name,
          tier: kofiData.tier_name || 'Unknown Tier',
          amount: kofiData.amount,
          currency: kofiData.currency,
          subscribed_at: kofiData.timestamp || new Date().toISOString(),
          last_payment: kofiData.timestamp || new Date().toISOString(),
          active: true
        };
        db.subscribers.push(newSubscriber);
        console.log(`New subscriber: ${newSubscriber.name} at tier ${newSubscriber.tier}`);
      }
      writeDatabase(db);
    } else {
      console.log(`Received non-subscription event type: ${kofiData.type}`);
    }
    res.status(200).send('Webhook received');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(200).send('Error logged');
  }
});

// Simple dashboard (NO password protection anymore)
// REMOVED dashboardAuth helper function as it's no longer needed

// Apply the dashboard route WITHOUT the auth middleware
app.get('/dashboard', (req, res) => {
  const db = readDatabase();
  const tierCounts = {};
  Object.keys(TIERS).forEach(tierName => { tierCounts[tierName] = 0; });
  tierCounts['Unknown Tier'] = 0;
  db.subscribers.filter(s => s.active).forEach(sub => {
    const tierName = sub.tier || 'Unknown Tier';
    if (tierCounts.hasOwnProperty(tierName)) {
      tierCounts[tierName]++;
    } else {
      if (!tierCounts['Other']) tierCounts['Other'] = 0;
      tierCounts['Other']++;
      console.log(`Found subscriber with unexpected tier: ${tierName}`);
    }
  });

  let html = `
    <html>
      <head>
        <title>Subscriber Dashboard</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 20px; background-color: #f4f4f4; color: #333; }
          h1, h2 { color: #4CAF50; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 30px; box-shadow: 0 2px 3px rgba(0,0,0,0.1); background-color: #fff; }
          th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
          tr:nth-child(even) { background-color: #f9f9f9; }
          th { background-color: #4CAF50; color: white; font-weight: bold; }
          .tier-info, .summary, .subscriber-list { background-color: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-bottom: 30px; }
          .count-badge { background-color: #007bff; color: white; border-radius: 10px; padding: 3px 8px; margin-left: 10px; font-size: 0.9em; }
          .error { color: red; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>Subscriber Dashboard</h1>
        <div class="summary">
          <h2>Summary</h2>
          <p>Total Active Subscribers: <strong>${db.subscribers.filter(s => s.active).length}</strong></p>
        </div>
        <div class="tier-info">
          <h2>Tier Information</h2>
          <table>
            <thead><tr><th>Tier Name</th><th>Price</th><th>API Access</th><th>Daily Messages</th><th>Active Subscribers</th></tr></thead>
            <tbody>
  `;

  Object.entries(TIERS).forEach(([tierName, info]) => {
    html += `<tr><td>${tierName}</td><td>${info.price}</td><td>${info.api}</td><td>${info.messages}</td><td>${tierCounts[tierName] || 0} <span class="count-badge">${tierCounts[tierName] || 0}</span></td></tr>`;
  });

  if (tierCounts['Unknown Tier'] > 0) {
    html += `<tr><td>Unknown Tier</td><td>N/A</td><td>N/A</td><td>N/A</td><td>${tierCounts['Unknown Tier']} <span class="count-badge">${tierCounts['Unknown Tier']}</span></td></tr>`;
  }
  if (tierCounts['Other'] > 0) {
    html += `<tr><td>Other Tiers</td><td>N/A</td><td>N/A</td><td>N/A</td><td>${tierCounts['Other']} <span class="count-badge">${tierCounts['Other']}</span></td></tr>`;
  }

  html += `
            </tbody></table></div>
        <div class="subscriber-list">
          <h2>Active Subscribers</h2>
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Tier</th><th>API Messages</th><th>Amount</th><th>Subscribed At</th><th>Last Payment</th></tr></thead>
            <tbody>
  `;

  db.subscribers
    .filter(s => s.active)
    .sort((a, b) => (TIERS[a.tier]?.messages || 0) - (TIERS[b.tier]?.messages || 0))
    .forEach(subscriber => {
      const tierName = subscriber.tier || 'Unknown Tier';
      const tierInfo = TIERS[tierName] || { messages: 'N/A', api: 'N/A' };
      const subscribedAt = subscriber.subscribed_at ? new Date(subscriber.subscribed_at).toLocaleString() : 'N/A';
      const lastPayment = subscriber.last_payment ? new Date(subscriber.last_payment).toLocaleString() : 'N/A';
      html += `<tr><td>${subscriber.name || 'N/A'}</td><td>${subscriber.email || 'N/A'}</td><td>${tierName}</td><td>${tierInfo.messages}</td><td>${subscriber.amount || 'N/A'} ${subscriber.currency || ''}</td><td>${subscribedAt}</td><td>${lastPayment}</td></tr>`;
    });

  html += `</tbody></table></div></body></html>`;
  res.send(html);
});

// Root route for health check
app.get('/', (req, res) => {
  res.send('Ko-fi webhook handler is running!');
});

// Basic Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack);
  res.status(500).send('Something broke!');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Dashboard available at /dashboard (NO AUTHENTICATION)`);
  console.log(`Webhook endpoint at /kofi-webhook (requires Basic Auth)`);
});
