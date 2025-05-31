import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import TelegramBot from "node-telegram-bot-api";
import path from "path";
import os from "os";

const DOCUMENT_NUMBER = process.env.DOCUMENT_NUMBER!;
const VEHICLE_NUMBER = process.env.VEHICLE_NUMBER!;
const BOT_TOKEN = process.env.BOT_TOKEN!;
const CHAT_ID = process.env.CHAT_ID!;

if (!DOCUMENT_NUMBER || !VEHICLE_NUMBER || !BOT_TOKEN || !CHAT_ID) {
  console.error("❌ Один из обязательных параметров не передан!");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN);

const BASE_URL = "https://videos.police.ge/";

const jar = new CookieJar();
const client = wrapper(
  axios.create({
    jar,
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
      "accept-language": "ru,en-GB;q=0.9,en-US;q=0.8,en;q=0.7",
      "cache-control": "max-age=0",
      "sec-ch-ua": '"Chromium";v="133", "Not(A:Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      Referer: `${BASE_URL}`,
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  })
);

const getHeaders = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
};

type Fine = {
  protocolNumber: string;
  carNumber: string;
  date: string;
  violationCode: string;
  amount: string;
  totalAmount: string;
  images: string[];
};

const fetchFines = async () => {
  try {
    const mainPage = await client.get(`${BASE_URL}index.php?lang=en`, {
      headers: getHeaders,
    });
    const $main = cheerio.load(mainPage.data);
    const csrfToken = $main('input[name="csrf_token"]').val();

    const formData = new URLSearchParams({
      protocolNo: "",
      personalNo: "",
      documentNo: DOCUMENT_NUMBER,
      vehicleNo2: VEHICLE_NUMBER,
      lang: "en",
      csrf_token: csrfToken ?? "",
    });

    const res = await client.post(
      `${BASE_URL}submit-index.php`,
      formData.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    const $ = cheerio.load(res.data);

    const noViolationsFound = $("body")
      .text()
      .includes("Administrative violations have not been found.");
    if (noViolationsFound) {
      console.log("✅ Нарушений не найдено.");
      return;
    }

    const rows = $(".row").toArray();

    for (const el of rows) {
      const row = $(el);
      const payLinkElement = row.find('a[href*="mpi.gc.ge"]');
      if (!payLinkElement.length) continue;

      const linkElement = row.find("a").first();
      const detailLink = linkElement.attr("href");
      if (!detailLink) continue;

      const fine = await getDetailedFine(detailLink);
      if (!fine) continue;

      const knownFines = loadSavedFines();
      const alreadyExists = knownFines.some(
        (f) => f.protocolNumber === fine.protocolNumber
      );

      if (!alreadyExists) {
        await notifyAboutNewFine(fine);
        saveFines([...knownFines, fine]);
      }
    }
  } catch (err) {
    console.error("❌ Ошибка запроса:", err);
  }
};

const getDetailedFine = async (
  detailUrl: string
): Promise<Fine | undefined> => {
  try {
    const res = await client.get(BASE_URL + detailUrl, { headers: getHeaders });
    const $ = cheerio.load(res.data);

    const getValue = (label: string) =>
      $(`div:contains("${label}")`)
        .filter((_, el) => $(el).text().trim() === label)
        .parent()
        .contents()
        .eq(1)
        .text()
        .trim();

    const fine: Fine = {
      protocolNumber: getValue("Protocol number:"),
      carNumber: getValue("Car state number:"),
      date: getValue("Date:"),
      violationCode: getValue("Violation code:"),
      amount: getValue("Amount:"),
      totalAmount: getValue("Total amount:"),
      images: [],
    };

    const imgElements = $('img[src^="jpgimage.php"]');
    for (let i = 0; i < imgElements.length; i++) {
      const src = $(imgElements[i]).attr("src");
      if (!src) continue;
      const imgRes = await client.get(BASE_URL + src, {
        responseType: "arraybuffer",
      });
      const fileName = `fine_image_${Date.now()}_${i}.jpg`;
      const filePath = path.join(os.tmpdir(), fileName);
      fs.writeFileSync(filePath, imgRes.data);
      fine.images.push(filePath);
    }
    return fine;
  } catch (err) {
    console.error("❌ Ошибка при получении данных штрафа:", err);
    return undefined;
  }
};

const loadSavedFines = (): Fine[] => {
  try {
    return JSON.parse(fs.readFileSync("/root/police-bot/data.json", "utf-8"));
  } catch {
    return [];
  }
};

const saveFines = (fines: Fine[]) => {
  return fs.writeFileSync(
    "/root/police-bot/data.json",
    JSON.stringify(fines, null, 2)
  );
};

const notifyAboutNewFine = async (fine: Fine) => {
  const message = `🛑 Новое нарушение:

📄 Протокол: ${fine.protocolNumber}
🚗 Авто: ${fine.carNumber}
📅 Дата: ${fine.date}
📘 Нарушение: ${fine.violationCode}
💵 Сумма: ${fine.amount}
💰 Итого: ${fine.totalAmount}`;

  await bot.sendMessage(CHAT_ID, message);
  await bot.sendMessage(CHAT_ID, fine.protocolNumber);

  for (const imgPath of fine.images) {
    try {
      await bot.sendPhoto(CHAT_ID, imgPath);
    } catch (err) {
      console.error("❌ Ошибка отправки изображения в Telegram:", err);
    } finally {
      try {
        fs.unlinkSync(imgPath);
      } catch (err) {
        console.error("❌ Ошибка удаления временного файла:", err);
      }
    }
  }
};

(async () => {
  await fetchFines();
})();
