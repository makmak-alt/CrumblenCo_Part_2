/**
 * Crumble & Co — Google Apps Script webhook (MVI version)
 *
 * What it does:
 *   type "order"  → appends the order to the Google Sheet + emails customer AND owner
 *   type "status" → emails the customer when the owner updates status (e.g. payment confirmed)
 *
 * How to install:
 *   1. Open your existing Apps Script project (the one behind your current webhook URL)
 *   2. Replace ALL the code with this file
 *   3. Set OWNER_EMAIL below if it changed
 *   4. Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy
 *      (the URL stays the same, so the website and Cloudflare Worker keep working)
 */

var OWNER_EMAIL = "basrahbakerj@gmail.com"; // ← owner notification address

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.type === "status") {
      handleStatusUpdate(data);
    } else {
      handleNewOrder(data); // default: new order (also stays compatible with the old website)
    }
    return ContentService.createTextOutput(
      JSON.stringify({ ok: true })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/* ─── NEW ORDER: Sheet row + confirmation emails ─── */
function handleNewOrder(d) {
  // Sheet write first, but never let a sheet problem stop the emails
  try {
    var sheet = getOrdersSheet_();
    sheet.appendRow([
    d.timestamp || new Date().toLocaleString("en-ZA"), // Time Stamp
    d.order_num || d.orderNum || "",                   // Order Number
    d.name || "",                                      // Name
    d.phone || "",                                     // Phone
    d.email || "",                                     // Email Address
    d.items || "",                                     // Items
    d.total || "",                                     // Total
    d.delivery || "",                                  // Delivery
    d.address || "",                                   // Address
      d.status || "New",                                 // Status
    ]);
  } catch (err) {
    // Sheet logging is best-effort; Supabase is the source of truth now.
  }

  var orderNum = d.order_num || d.orderNum || "";

  if (d.email) {
    MailApp.sendEmail({
      to: d.email,
      subject: "Order confirmed — " + orderNum + " 🍪 Crumble & Co",
      body:
        "Hi " + d.name + ",\n\n" +
        "Thank you for your order! Here are your details:\n\n" +
        "Order number: " + orderNum + "\n" +
        "Items: " + d.items + "\n" +
        (d.delivery === "Delivery"
          ? "Delivery to: " + d.address + "\n"
          : "Pickup: Diep River\n") +
        "Total: " + d.total + "\n\n" +
        "Please complete payment via SnapScan or EFT using your order number (" + orderNum +
        ") as the reference. We start baking once payment is confirmed — usually within 24–48 hours.\n\n" +
        "You can track your order anytime on our website with your order number and this email address.\n\n" +
        "Warm regards,\nCrumble & Co",
    });
  }

  MailApp.sendEmail({
    to: OWNER_EMAIL,
    subject: "New order " + orderNum + " — " + (d.total || ""),
    body:
      "New order received:\n\n" +
      "Order: " + orderNum + "\n" +
      "Customer: " + d.name + " (" + d.email + ", " + (d.phone || "no phone") + ")\n" +
      "Items: " + d.items + "\n" +
      (d.delivery === "Delivery"
        ? "Delivery to: " + d.address + "\n"
        : "Pickup: Diep River\n") +
      "Total: " + d.total + "\n\n" +
      "Remember to check SnapScan/your bank for payment, then mark it paid in the owner dashboard.",
  });
}

/* ─── STATUS UPDATE: email the customer ─── */
function handleStatusUpdate(d) {
  if (!d.email) return;

  var messages = {
    Paid:
      "Your payment has been confirmed — thank you! 🎉\n\n" +
      "We start baking your cookies now and they'll be ready within 24–48 hours. " +
      "We'll let you know the moment they're " +
      (d.delivery === "Delivery" ? "on the way." : "ready for collection in Diep River."),
    Baking: "Good news — your cookies are in the oven! 🔥",
    Packing: "Your order is being quality-checked and packed. 📦 Almost there!",
    Ready:
      d.delivery === "Delivery"
        ? "Your order is on its way! 🚗"
        : "Your order is ready for collection in Diep River! 🏪 See you soon!",
    Delivered: "Your order has been delivered. Enjoy every bite! 🍪",
    Cancelled:
      "Your order has been cancelled. If you think this is a mistake, please WhatsApp us.",
  };

  var msg = messages[d.status];
  if (!msg) return; // 'New' or unknown status → no email

  MailApp.sendEmail({
    to: d.email,
    subject: "Order " + d.order_num + " update: " + d.status + " 🍪 Crumble & Co",
    body:
      "Hi " + d.name + ",\n\n" +
      msg + "\n\n" +
      "Order number: " + d.order_num + "\n" +
      "Items: " + (d.items || "") + "\n" +
      "Total: " + (d.total || "") + "\n\n" +
      "Track anytime on our website with your order number and email.\n\n" +
      "Warm regards,\nCrumble & Co",
  });

  // Keep the Sheet status column in sync (Order Number = column B, Status = column J)
  try {
    var sheet = getOrdersSheet_();
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][1]) === String(d.order_num)) {
        sheet.getRange(i + 1, 10).setValue(d.status);
        break;
      }
    }
  } catch (err) {
    // Sheet sync is best-effort; Supabase is the source of truth now.
  }
}

/* ─── helpers ─── */
// Run this manually (▶ Run in the editor) ONCE after pasting the code:
// it forces Google to show the authorization prompt and sends a test email.
// If the test email arrives, the webhook will work too.
function testEmail() {
  MailApp.sendEmail({
    to: OWNER_EMAIL,
    subject: "Crumble & Co webhook test ✅",
    body: "If you can read this, the Apps Script email setup works.",
  });
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("Spreadsheet: " + (ss ? ss.getName() : "NONE — set SPREADSHEET_ID"));
}

// If your script is STANDALONE (not attached to the Sheet), paste your Sheet's ID
// here (the long code in the Sheet's URL between /d/ and /edit). If the script is
// bound to the Sheet you can leave it empty.
var SPREADSHEET_ID = "";

function getOrdersSheet_() {
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("No spreadsheet found — set SPREADSHEET_ID in Code.gs");
  var sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Time Stamp", "Order Number", "Name", "Phone", "Email Address",
      "Items", "Total", "Delivery", "Address", "Status",
    ]);
  }
  return sheet;
}
