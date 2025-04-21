## 🚓 Police Fines Bot

This project automatically checks for unpaid traffic fines using your vehicle and document numbers, and sends weekly (or
periodic) updates via Telegram.

### 📦 Installation & Setup

1. **Install a Linux distribution**

   You can use any lightweight Linux distribution. I used **Alpine Linux** in my case.

2. **Clone the project to your user folder**

   Download or clone this directory to your user's home directory.
   In my case, it's `/root`.

   > **Important**: The script uses **absolute paths**, so make sure the project stays where it is.

3. **Install dependencies using Yarn**

   Inside the project folder:

   ```bash
   yarn
   ```

4. **Set up a cron job**

   Add a cron entry to periodically run the script with your personal data as environment variables.
   Example for checking every 10 minutes:

   ```bash
   crontab -e
   ```

   Add the following line (replace values accordingly):

   ```cron
   */10 * * * * DOCUMENT_NUMBER=WWW VEHICLE_NUMBER=XXX BOT_TOKEN=YYY CHAT_ID=ZZZ /root/police-bot/node_modules/.bin/tsx /root/police-bot/index.ts >> /var/log/fines_bot.log 2>&1
   ```

   - `DOCUMENT_NUMBER`: Your driver's license number
   - `VEHICLE_NUMBER`: Your car registration number
   - `BOT_TOKEN`: Your Telegram bot token
   - `CHAT_ID`: Your Telegram chat ID

5. **Restart the cron service**

   On Alpine Linux:

   ```bash
   /etc/init.d/crond restart
   ```

6. **Monitor logs**

   You can check if the bot is working correctly by tailing the log:

   ```bash
   tail -f /var/log/fines_bot.log
   ```
