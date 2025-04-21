// index.js
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());

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
    const data = req.body.data;
    console.log('Received webhook:', data);

    // Check if it's a subscription event
    if (data.type === 'Subscription') {
      const db = readDatabase();

      // Handle new subscription
      if (data.is_first_subscription_payment) {
        const newSubscriber = {
          id: data.kofi_transaction_id,
          email: data.email,
          name: data.from_name,
          tier: data.tier_name,
          subscribed_at: new Date().toISOString(),
          active: true
        };

        db.subscribers.push(newSubscriber);
        console.log(`New subscriber: ${newSubscriber.name} at tier ${newSubscriber.tier}`);
      }
      // Handle subscription renewal
      else if (data.is_public && !data.is_subscription_payment_failed) {
        const subscriber = db.subscribers.find(s => s.email === data.email);
        if (subscriber) {
          subscriber.active = true;
          subscriber.last_payment = new Date().toISOString();
          console.log(`Subscription renewed: ${subscriber.name}`);
        }
      }
      // Handle failed payment
      else if (data.is_subscription_payment_failed) {
        const subscriber = db.subscribers.find(s => s.email === data.email);
        if (subscriber) {
          subscriber.active = false;
          subscriber.failed_at = new Date().toISOString();
          console.log(`Subscription payment failed: ${subscriber.name}`);
        }
      }

      writeDatabase(db);
    }

    res.status(200).send('Webhook received');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Error processing webhook');
  }
});

// Simple dashboard (password protected)
app.get('/dashboard', (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || authHeader !== `Basic ${Buffer.from(process.env.DASHBOARD_PASSWORD).toString('base64')}`) {
    res.set('WWW-Authenticate', 'Basic realm="Subscriber Dashboard"');
    return res.status(401).send('Authentication required');
  }

  const db = readDatabase();

  let html = `
    <html>
      <head>
        <title>Subscriber Dashboard</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          tr:nth-child(even) { background-color: #f2f2f2; }
          th { background-color: #4CAF50; color: white; }
        </style>
      </head>
      <body>
        <h1>Active Subscribers</h1>
        <table>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Tier</th>
            <th>Subscribed At</th>
          </tr>
  `;

  db.subscribers
    .filter(s => s.active)
    .forEach(subscriber => {
      html += `
        <tr>
          <td>${subscriber.name}</td>
          <td>${subscriber.email}</td>
          <td>${subscriber.tier}</td>
          <td>${new Date(subscriber.subscribed_at).toLocaleString()}</td>
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

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
