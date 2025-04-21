// index.js
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

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
app.use(bodyParser.urlencoded({ extended: true })); // Added for form-urlencoded data

// Database file path
const DB_PATH = path.join(__dirname, 'subscribers.json');

// Initialize database if it doesn't exist
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({ subscribers: [] }));
}

// Helper function to read database
function readDatabase() {
  const data = fs.readFileSync(DB_PATH);
  return JSON.parse(data);
}

// Helper function to write to database
function writeDatabase(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Ko-fi webhook endpoint
app.post('/kofi-webhook', (req, res) => {
  try {
    // Ko-fi sends data as application/x-www-form-urlencoded with a 'data' field
    const kofiData = JSON.parse(req.body.data);
    console.log('Received webhook:', kofiData);

    // Verify webhook is from Ko-fi
    if (kofiData.verification_token !== KOFI_VERIFICATION_TOKEN) {
      console.log('Invalid verification token');
      return res.status(200).send('Invalid verification token'); // Still return 200 to prevent retries
    }

    // Check if it's a subscription event
    if (kofiData.type === 'Subscription') {
      const db = readDatabase();

      // Handle new subscription
      if (kofiData.is_first_subscription_payment) {
        const newSubscriber = {
          id: kofiData.kofi_transaction_id,
          email: kofiData.email,
          name: kofiData.from_name,
          tier: kofiData.tier_name || 'Default',
          amount: kofiData.amount,
          currency: kofiData.currency,
          subscribed_at: kofiData.timestamp || new Date().toISOString(),
          active: true
        };

        db.subscribers.push(newSubscriber);
        console.log(`New subscriber: ${newSubscriber.name} at tier ${newSubscriber.tier}`);
      }
      // Handle subscription renewal
      else if (kofiData.is_subscription_payment) {
        const subscriber = db.subscribers.find(s => s.email === kofiData.email);
        if (subscriber) {
          subscriber.active = true;
          subscriber.last_payment = kofiData.timestamp || new Date().toISOString();
          subscriber.tier = kofiData.tier_name || subscriber.tier; // Update tier in case it changed
          subscriber.amount = kofiData.amount || subscriber.amount;
          console.log(`Subscription renewed: ${subscriber.name}`);
        } else {
          // If subscriber not found, add them (might happen if database was reset)
          const newSubscriber = {
            id: kofiData.kofi_transaction_id,
            email: kofiData.email,
            name: kofiData.from_name,
            tier: kofiData.tier_name || 'Default',
            amount: kofiData.amount,
            currency: kofiData.currency,
            subscribed_at: kofiData.timestamp || new Date().toISOString(),
            active: true
          };
          db.subscribers.push(newSubscriber);
          console.log(`Added existing subscriber: ${newSubscriber.name}`);
        }
      }

      writeDatabase(db);
    }

    // Always return 200 to acknowledge receipt
    res.status(200).send('Webhook received');
  } catch (error) {
    console.error('Error processing webhook:', error);
    // Still return 200 so Ko-fi doesn't retry
    res.status(200).send('Error logged');
  }
});

// Simple dashboard (password protected)
app.get('/dashboard', (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || authHeader !== `Basic ${Buffer.from(process.env.DASHBOARD_PASSWORD || 'admin').toString('base64')}`) {
    res.set('WWW-Authenticate', 'Basic realm="Subscriber Dashboard"');
    return res.status(401).send('Authentication required');
  }

  const db = readDatabase();

  // Count subscribers by tier
  const tierCounts = {};
  TIERS.forEach(tier => tierCounts[tier] = 0);
  tierCounts['Other'] = 0;

  db.subscribers.filter(s => s.active).forEach(sub => {
    if (TIERS[sub.tier]) {
      tierCounts[sub.tier]++;
    } else {
      tierCounts['Other']++;
    }
  });

  let html = `
    <html>
      <head>
        <title>Subscriber Dashboard</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 30px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          tr:nth-child(even) { background-color: #f2f2f2; }
          th { background-color: #4CAF50; color: white; }
          .tier-info { margin-bottom: 30px; }
          .summary { margin-bottom: 30px; }
          .count-badge {
            background-color: #007bff;
            color: white;
            border-radius: 10px;
            padding: 3px 8px;
            margin-left: 5px;
          }
        </style>
      </head>
      <body>
        <h1>Subscriber Dashboard</h1>

        <div class="summary">
          <h2>Summary</h2>
          <p>Total Active Subscribers: ${db.subscribers.filter(s => s.active).length}</p>
        </div>

        <div class="tier-info">
          <h2>Tier Information</h2>
          <table>
            <tr>
              <th>Tier Name</th>
              <th>Price</th>
              <th>API Access</th>
              <th>Daily Messages</th>
              <th>Subscribers</th>
            </tr>
  `;

  Object.entries(TIERS).forEach(([tierName, info]) => {
    html += `
      <tr>
        <td>${tierName}</td>
        <td>${info.price}</td>
        <td>${info.api}</td>
        <td>${info.messages}</td>
        <td>${tierCounts[tierName] || 0}</td>
      </tr>
    `;
  });

  html += `
          </table>
        </div>

        <h2>Active Subscribers</h2>
        <table>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Tier</th>
            <th>API Messages</th>
            <th>Amount</th>
            <th>Subscribed At</th>
            <th>Last Payment</th>
          </tr>
  `;

  db.subscribers
    .filter(s => s.active)
    .sort((a, b) => a.tier.localeCompare(b.tier))
    .forEach(subscriber => {
      const tierInfo = TIERS[subscriber.tier] || { messages: 'N/A', api: 'N/A' };
      html += `
        <tr>
          <td>${subscriber.name}</td>
          <td>${subscriber.email}</td>
          <td>${subscriber.tier || 'Default'}</td>
          <td>${tierInfo.messages}</td>
          <td>${subscriber.amount || 'N/A'} ${subscriber.currency || ''}</td>
          <td>${new Date(subscriber.subscribed_at).toLocaleString()}</td>
          <td>${subscriber.last_payment ? new Date(subscriber.last_payment).toLocaleString() : 'N/A'}</td>
        </tr>
      `;
    });

  html += `
        </table>
      </body>
    </html>
  `;

  res.send(html);
});

// Root route for health check
app.get('/', (req, res) => {
  res.send('Ko-fi webhook handler is running!');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
