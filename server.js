import express from 'express';
import multer from 'multer';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve built frontend
app.use(express.static(join(__dirname, 'dist')));

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Only PNG and JPG files are allowed'));
    }
  }
});

const client = new Anthropic();

function buildSystemPrompt(tradingStyle) {
  const styleGuides = {
    scalping: 'Focus on very short-term setups (minutes to hours). TP should be 0.5-1.5% from entry, SL should be 0.2-0.5% from entry.',
    daytrading: 'Focus on intraday setups (hours). TP should be 1-3% from entry, SL should be 0.5-1% from entry.',
    swingtrading: 'Focus on multi-day to multi-week setups. TP should be 5-15% from entry, SL should be 2-5% from entry.'
  };

  return `You are an expert technical analyst and professional stock/crypto trader with 20+ years of experience analyzing chart patterns.

Trading style context: ${styleGuides[tradingStyle] || styleGuides.daytrading}

Analyze the provided chart image thoroughly and respond ONLY with a valid JSON object (no markdown, no extra text) in this exact format:

{
  "rating": "Strong Buy" | "Buy" | "Neutral" | "Sell" | "Strong Sell",
  "confidence": <number 0-100>,
  "entryPrice": <estimated numeric price based on chart>,
  "takeProfit": <estimated numeric TP price>,
  "stopLoss": <estimated numeric SL price>,
  "riskRewardRatio": "<X:1 format>",
  "percentageGain": <numeric percentage>,
  "percentageRisk": <numeric percentage>,
  "trendDirection": "Uptrend" | "Downtrend" | "Sideways",
  "keyLevels": {
    "support": [<price1>, <price2>],
    "resistance": [<price1>, <price2>]
  },
  "patterns": ["<pattern1>", "<pattern2>"],
  "indicators": {
    "rsi": "<RSI observation or null>",
    "macd": "<MACD observation or null>",
    "volume": "<Volume observation or null>"
  },
  "analysis": {
    "trendExplanation": "<detailed trend analysis>",
    "reasonForRating": "<why this rating was given>",
    "keyLevelsExplanation": "<explanation of support/resistance>",
    "riskWarnings": ["<warning1>", "<warning2>"],
    "setupQuality": "<description of the overall setup quality>"
  },
  "ticker": "<stock ticker if visible, else null>",
  "timeframe": "<timeframe if visible, else estimated>"
}

Important instructions:
- Base all price estimates on actual visible price levels in the chart
- If exact prices aren't visible, estimate relative percentages from the current price area
- Be conservative with confidence scores (50-75 is typical, 76-90 for very clear setups, 91-100 only for textbook perfect setups)
- Always identify at least one risk warning
- Analyze all visible indicators (RSI, MACD, volume bars if present)
- Look for candlestick patterns: doji, hammer, engulfing, shooting star, morning/evening star
- Identify trend structure: higher highs/higher lows for uptrend, lower highs/lower lows for downtrend`;
}

app.post('/api/analyze', upload.single('chart'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const tradingStyle = req.body.tradingStyle || 'daytrading';
    const imageBase64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;

    const message = await client.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 2048,
      system: buildSystemPrompt(tradingStyle),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: imageBase64
              }
            },
            {
              type: 'text',
              text: `Analyze this stock chart image and provide your complete technical analysis. Trading style: ${tradingStyle}. Return ONLY valid JSON, no other text.`
            }
          ]
        }
      ]
    });

    const responseText = message.content[0].text.trim();

    // Clean up any potential markdown wrapping
    const cleanedResponse = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let analysisResult;
    try {
      analysisResult = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Raw response:', responseText);
      return res.status(500).json({ error: 'Failed to parse AI analysis response' });
    }

    res.json({ success: true, analysis: analysisResult });

  } catch (error) {
    console.error('Analysis error:', error);
    if (error.status === 401) {
      return res.status(401).json({ error: 'Invalid API key. Please set ANTHROPIC_API_KEY environment variable.' });
    }
    res.status(500).json({ error: error.message || 'Analysis failed' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: 'claude-opus-4-5-20251101' });
});

// SPA fallback (Express v5 uses {*path} syntax)
app.get('/{*path}', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ChartEdge AI running on http://localhost:${PORT}`);
});
