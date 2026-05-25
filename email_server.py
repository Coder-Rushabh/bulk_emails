from flask import Flask, request, jsonify
from flask_cors import CORS
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os
import json
from datetime import date

app = Flask(__name__)
CORS(app)  # This allows your React app to talk to this server

# --- CONFIGURATION ---
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
SENDER_EMAIL = ""
SENDER_PASSWORD = ""
DAILY_SEND_LIMIT = 100
LIMIT_TRACK_FILE = os.path.join(os.path.dirname(__file__), 'email_limit.json')
# ---------------------

# Load or initialize daily send counts from file
if os.path.exists(LIMIT_TRACK_FILE):
    try:
        with open(LIMIT_TRACK_FILE, 'r', encoding='utf-8') as _f:
            send_counts = json.load(_f)
    except Exception:
        send_counts = {}
else:
    send_counts = {}

def save_send_counts():
    try:
        with open(LIMIT_TRACK_FILE, 'w', encoding='utf-8') as _f:
            json.dump(send_counts, _f)
    except Exception as save_err:
        print(f"Warning: could not save send count file: {save_err}")

def get_today_count():
    today = date.today().isoformat()
    return send_counts.get(today, 0)

def increment_today_count():
    today = date.today().isoformat()
    send_counts[today] = send_counts.get(today, 0) + 1
    save_send_counts()

@app.route('/send-email', methods=['POST'])
def send_email():
    data = request.json
    recipient = data.get('to')
    subject = data.get('subject')
    body = data.get('body')
    
    # Dynamic credentials
    sender_email = data.get('sender_email', SENDER_EMAIL)
    sender_password = data.get('sender_password', SENDER_PASSWORD)
    smtp_server = data.get('smtp_server', SMTP_SERVER)
    smtp_port = data.get('smtp_port', SMTP_PORT)

    if not all([recipient, subject, body]):
        return jsonify({"error": "Missing data"}), 400

    if get_today_count() >= DAILY_SEND_LIMIT:
        return jsonify({"error": "Daily email sending limit reached."}), 429

    try:
        # Create the email
        msg = MIMEMultipart()
        msg['From'] = sender_email
        msg['To'] = recipient
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))

        # Connect to server and send
        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()  # Secure the connection
        server.login(sender_email, sender_password)
        server.send_message(msg)
        server.quit()
        increment_today_count()

        return jsonify({"message": "Email sent successfully!"}), 200
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    print(f"Email server starting on http://localhost:5000")
    print(f"Using sender: {SENDER_EMAIL}")
    app.run(port=5000)
