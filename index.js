const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(bodyParser.text({ 
  type: ['text/plain', 'application/json'],
  limit: '10mb'
}));

// Generate Mermaid diagram code
app.post('/generate-diagram', (req, res) => {
  try {
    let processText = req.body;
    
    if (typeof processText !== 'string') {
      processText = JSON.stringify(processText);
    }

    if (!processText || processText.trim().length === 0) {
      return res.status(400).json({ error: 'Empty input received' });
    }

    const mermaidCode = parseProcessToMermaid(processText);
    res.send(mermaidCode);
  } catch (error) {
    res.status(500).json({ error: 'Diagram error: ' + error.message });
  }
});

// Generate PDF endpoint
app.post('/generate-pdf', async (req, res) => {
  let browser;
  try {
    const mermaidCode = req.body.trim();
    console.log('Received Mermaid code:', mermaidCode);

    // Validate Mermaid code
    if (!mermaidCode || !mermaidCode.startsWith('graph TD')) {
      return res.status(400).json({ error: 'Invalid Mermaid code format' });
    }

    browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage' // Add this for memory management
      ],
      timeout: 60000
    });

    const page = await browser.newPage();
    
    // Configure HTML template
    const htmlContent = `
      <html>
        <head>
          <style>
            body { 
              padding: 2cm;
              font-family: "Arial", sans-serif !important;
              background: white;
            }
            .mermaid-container {
              width: 100%;
              min-height: 80vh;
            }
            .mermaid svg {
              background-color: white !important;
            }
            .label text {
              fill: black !important;
              font-family: Arial !important;
            }
          </style>
          <script src="https://cdn.jsdelivr.net/npm/mermaid@10.6.1/dist/mermaid.min.js"></script>
        </head>
        <body>
          <div class="mermaid-container">
            <div class="mermaid">${mermaidCode}</div>
          </div>
          <script>
            mermaid.initialize({ 
              startOnLoad: true,
              securityLevel: 'loose',
              theme: 'neutral',
              flowchart: {
                diagramPadding: 20
              }
            });
          </script>
        </body>
      </html>
    `;

    await page.setContent(htmlContent, { 
      waitUntil: ['networkidle0', 'domcontentloaded'],
      timeout: 30000
    });

    // Wait for diagram to fully render
    await page.waitForFunction(() => {
      const svg = document.querySelector('.mermaid svg');
      return svg && svg.childElementCount > 0;
    }, { timeout: 30000 });

    // Debugging: Take screenshot
    await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '2cm', right: '2cm', bottom: '2cm', left: '2cm' },
      timeout: 60000,
      preferCSSPageSize: true
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="process-diagram.pdf"',
      'Content-Length': pdfBuffer.length
    });
    res.send(pdfBuffer);

  } catch (error) {
    console.error('PDF Generation Error:', error);
    res.status(500).json({ 
      error: 'PDF generation failed',
      details: error.message 
    });
  } finally {
    if (browser) await browser.close();
  }
});

function parseProcessToMermaid(text) {
  const steps = text.split('\n').filter(line => line.trim().length > 0);
  let mermaidCode = 'graph TD\n';
  let parentStack = [];
  
  const sanitizeText = (text) => {
    return text
      .replace(/[^a-zA-Z0-9\s-]/g, ' ') // Remove special characters
      .replace(/\s+/g, ' ')              // Collapse multiple spaces
      .trim();
  };

  steps.forEach((line, index) => {
    const cleanedLine = line.trim();
    
    // Main steps
    if (/^\d+\./.test(cleanedLine)) {
      const nodeId = `step${index}`;
      const nodeText = sanitizeText(cleanedLine.replace(/^\d+\.\s*/, ''));
      mermaidCode += `${nodeId}["${nodeText}"]\n`;
      
      if (parentStack.length > 0) {
        mermaidCode += `${parentStack[parentStack.length-1]} --> ${nodeId}\n`;
      }
      parentStack.push(nodeId);
    }
    // Sub-steps
    else if (/^-/.test(cleanedLine)) {
      if (parentStack.length === 0) return;
      const nodeId = `sub${index}`;
      const nodeText = sanitizeText(cleanedLine.replace(/^-\s*/, ''));
      mermaidCode += `${nodeId}["${nodeText}"]\n`;
      mermaidCode += `${parentStack[parentStack.length-1]} --> ${nodeId}\n`;
    }
  });

  return mermaidCode;
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
