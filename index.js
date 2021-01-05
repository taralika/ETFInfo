const ETF_URL = "https://www.etf.com/";
const nameSelector = '.font18.medium_blue_type.w-100.pull-left';
const segmentSelector = '.field-content.fundReportSegment';

//TODO: parse following labels in single loop
const erLabelText = "Expense Ratio";
const aumLabelText = "Assets Under Management";
const dividendLabelText = "Distribution Yield";
const inceptionLabelText = "Inception Date";

const ETFDB_URL = "https://etfdb.com/etf/";

const cheerio = require('cheerio');
const got = require('got');
const puppeteer = require('puppeteer-extra'); // need to use puppeteer-extra since etfdb.com blocks scraping

// Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// Add adblocker plugin to block all ads and trackers (saves bandwidth)
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

const PUPPETEER_OPTIONS = {
  headless: true,
  args: [
    '--no-sandbox'
  ],
};

const openConnection = async () => {
  const browser = await puppeteer.launch(PUPPETEER_OPTIONS);
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1050 });
  return { browser, page };
};

const closeConnection = async (page, browser) => {
  page && (await page.close());
  browser && (await browser.close());
};

// convert strings like "$123.45M" into numeric 123450000
// also works for negative values
function strToNum(numStr)
{
  if (typeof numStr == 'undefined' || !numStr)
  {
    return 0;
  }

  const lastChar = numStr.substring(numStr.length-1); // "M"
  let num = Number(numStr.replace(/[^0-9.-]+/g,"")); // 123.45
  
  switch(lastChar) {
    case 'K':
      num *= 10**3;
      break;
    case 'M':
      num *= 10**6;
      break;
    case 'B':
      num *= 10**9;
      break;
  }

  return num;
}

exports.etfInfo = async (req, res) => {
  const ticker = req.query.t;
  res.setHeader('Content-Type', 'application/json');

  if (typeof ticker == 'undefined' || !ticker)
  {
    res.status(400).send(JSON.stringify({ error: "ETF ticker missing" }));
    return;
  }

  let { browser, page } = await openConnection();

  try 
  {
    await page.goto(ETF_URL+ticker, { waitUntil: 'load' });
    await page.waitForSelector(nameSelector);
    
    const name = await page.evaluate((nameSelector) => {
      return document.querySelector(nameSelector).textContent;
    }, nameSelector);
    
    const segment = await page.evaluate((segmentSelector) => {
      return document.querySelector(segmentSelector).textContent;
    }, segmentSelector);

    await page.exposeFunction("strToNum", strToNum);

    const aum = await page.evaluate((aumLabelText) => {
      let labels = document.getElementsByTagName("label");
      let aumString = "";

      for (var i = 0; i < labels.length; ++i) {
        if (labels[i].textContent.trim() == aumLabelText) {
          aumString = labels[i].nextElementSibling.textContent; // "$123.45M"
          break;
        }
      }

      return strToNum(aumString);
    }, aumLabelText);

    const grade = await page.evaluate(() => {
      const fundRatingElement = document.getElementById('fund-rating');
      
      if (typeof fundRatingElement == 'undefined' || !fundRatingElement)
      {
        return "-";
      }

      const letter = fundRatingElement.getAttribute('letter');

      if (letter.length != 1 || letter.charCodeAt(0) < 'A'.charCodeAt(0) || letter.charCodeAt(0) > 'Z')
      {
        return "-";
      }

      return letter.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
    });

    const score = await page.evaluate(() => {
      const fundRatingElement = document.getElementById('fund-rating');
      
      if (typeof fundRatingElement == 'undefined' || !fundRatingElement)
      {
        return "-";
      }

      const scoreString = fundRatingElement.getAttribute('score');
      return !isNaN(scoreString) ? Number(scoreString) : "-";
    });

    const pick = await page.evaluate(() => {
      const pickElement = document.getElementById('analystPick');
      return (typeof pickElement != 'undefined' && pickElement) ? true : false;
    });

    const er = await page.evaluate((erLabelText) => {
      let labels = document.getElementsByTagName("label");

      for (var i = 0; i < labels.length; ++i) {
        if (labels[i].textContent.trim() == erLabelText) {
          return labels[i].nextElementSibling.textContent; // "0.65%"
        }
      }
    }, erLabelText);

    const perf = await page.evaluate(() => {
      return {
        "YTD": document.querySelectorAll('.perfYtd')[1].textContent,
        "1M": document.querySelectorAll('.perf1Mo')[1].textContent,
        "3M": document.querySelectorAll('.perf3Mo')[1].textContent,
        "1Y": document.querySelectorAll('.perf1Yr')[1].textContent,
        "3Y": document.querySelectorAll('.perf3YrAnnualized')[1].textContent,
        "5Y": document.querySelectorAll('.perf5YrAnnualized')[1].textContent,
        "10Y": document.querySelectorAll('.perf10YrAnnualized')[1].textContent
      };
    });

    const dividend = await page.evaluate((dividendLabelText) => {
      let labels = document.getElementsByTagName("label");

      for (var i = 0; i < labels.length; ++i) {
        if (labels[i].textContent.trim() == dividendLabelText) {
          return labels[i].nextElementSibling.textContent; // "0.65%"
        }
      }
    }, dividendLabelText);

    const inception = await page.evaluate((inceptionLabelText) => {
      let labels = document.getElementsByTagName("label");

      for (var i = 0; i < labels.length; ++i) {
        if (labels[i].textContent.trim() == inceptionLabelText) {
          return labels[i].nextElementSibling.textContent; // "12/20/93"
        }
      }
    }, inceptionLabelText);

    const etfDBResponse = await got(ETFDB_URL + ticker, {throwHttpErrors: false, retry: 0});
    const $ = cheerio.load(etfDBResponse.body);

    const flow5d = strToNum($('.net-fund-flow.5-day').text().trim().split('\n')[1]);
    const flow1m = strToNum($('.net-fund-flow.1-month').text().trim().split('\n')[1]);

    res.status(200).send(JSON.stringify({ Name: name,
                                          Segment: segment,
                                          AUM: aum,
                                          Grade: grade,
                                          Score: score,
                                          Pick: pick,
                                          "Expense Ratio": er,
                                          Performance: perf,
                                          Dividend: dividend,
                                          Inception: inception,
                                          "5D Flow": flow5d,
                                          "1M Flow": flow1m }));
  } catch (err) {
    console.log(err.message);
    res.status(500).send(err.message);
  } finally {
    await closeConnection(page, browser);
  }
};