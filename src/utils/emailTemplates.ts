// Email template for consent confirmation
export function generateConsentEmailHTML(params: {
    fullName: string;
    acceptedAt: string;
    termsVersion: string;
    email: string;
}): string {
    const { fullName, acceptedAt, termsVersion, email } = params;
    const date = new Date(acceptedAt).toLocaleDateString('sv-SE', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    return `
<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bekräftelse av godkännande - Britta AI</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f5f5f5;
      color: #333;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 40px 30px;
      text-align: center;
      color: white;
    }
    .header h1 {
      margin: 0 0 10px 0;
      font-size: 28px;
      font-weight: 600;
    }
    .header p {
      margin: 0;
      opacity: 0.9;
      font-size: 16px;
    }
    .content {
      padding: 40px 30px;
    }
    .summary-box {
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .summary-box h2 {
      margin: 0 0 15px 0;
      font-size: 18px;
      color: #333;
    }
    .summary-item {
      margin: 10px 0;
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e9ecef;
    }
    .summary-item:last-child {
      border-bottom: none;
    }
    .summary-label {
      font-weight: 600;
      color: #666;
    }
    .summary-value {
      color: #333;
      text-align: right;
    }
    .section {
      margin: 30px 0;
    }
    .section h3 {
      font-size: 16px;
      color: #333;
      margin: 0 0 10px 0;
    }
    .section p {
      line-height: 1.6;
      color: #666;
      margin: 0 0 10px 0;
    }
    .section ul {
      margin: 10px 0;
      padding-left: 20px;
    }
    .section li {
      margin: 8px 0;
      color: #666;
      line-height: 1.5;
    }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      border-radius: 6px;
      margin: 10px 5px;
      font-weight: 500;
    }
    .footer {
      background: #f8f9fa;
      padding: 30px;
      text-align: center;
      font-size: 14px;
      color: #666;
    }
    .footer a {
      color: #667eea;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🤖 Britta AI</h1>
      <p>Bekräftelse av godkännande</p>
    </div>
    
    <div class="content">
      <p>Hej <strong>${fullName}</strong>,</p>
      
      <p>Tack för att du har godkänt våra användarvillkor och integritetspolicy! Detta e-postmeddelande bekräftar ditt godkännande och tjänar som din digitala kvittering.</p>
      
      <div class="summary-box">
        <h2>Sammanfattning av godkännande</h2>
        <div class="summary-item">
          <span class="summary-label">Namn:</span>
          <span class="summary-value">${fullName}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">E-postadress:</span>
          <span class="summary-value">${email}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Godkänt datum:</span>
          <span class="summary-value">${date}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Villkorsversion:</span>
          <span class="summary-value">${termsVersion}</span>
        </div>
      </div>
      
      <div class="section">
        <h3>Vad du har godkänt</h3>
        <p>Genom att använda Britta AI har du accepterat följande:</p>
        <ul>
          <li><strong>Användarvillkor:</strong> Villkor för användning av tjänsten</li>
          <li><strong>Integritetspolicy:</strong> Hur vi samlar in, använder och skyddar dina personuppgifter</li>
          <li><strong>AI-ansvarsfriskrivning:</strong> Information om AI:ns begränsningar och ditt eget ansvar</li>
          <li><strong>GDPR-rättigheter:</strong> Dina rättigheter enligt dataskyddsförordningen</li>
        </ul>
      </div>
      
      <div class="section">
        <h3>Dina rättigheter enligt GDPR</h3>
        <p>Du har alltid rätt att:</p>
        <ul>
          <li>Begära utdrag av dina personuppgifter</li>
          <li>Begära rättelse av felaktiga uppgifter</li>
          <li>Begära radering av dina uppgifter ("rätten att bli glömd")</li>
          <li>Invända mot vår behandling av dina uppgifter</li>
          <li>Begära dataportabilitet</li>
        </ul>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="https://britta-ai.se/terms.html" class="button">Läs användarvillkor</a>
        <a href="https://britta-ai.se/privacy.html" class="button">Läs integritetspolicy</a>
      </div>
      
      <div class="section">
        <p><strong>Behöver du hjälp?</strong></p>
        <p>Om du har frågor om dina uppgifter eller vill utöva dina rättigheter, kontakta oss på:</p>
        <p><a href="mailto:support@britta-ai.se">support@britta-ai.se</a></p>
      </div>
    </div>
    
    <div class="footer">
      <p><strong>Britta AI</strong></p>
      <p>Detta är ett automatiskt meddelande för att bekräfta ditt godkännande.</p>
      <p>
        <a href="https://britta-ai.se/terms.html">Användarvillkor</a> | 
        <a href="https://britta-ai.se/privacy.html">Integritetspolicy</a>
      </p>
      <p style="margin-top: 15px; font-size: 12px; color: #999;">
        © ${new Date().getFullYear()} Britta AI. Alla rättigheter förbehållna.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

// Plain text version for email clients that don't support HTML
export function generateConsentEmailText(params: {
    fullName: string;
    acceptedAt: string;
    termsVersion: string;
    email: string;
}): string {
    const { fullName, acceptedAt, termsVersion, email } = params;
    const date = new Date(acceptedAt).toLocaleDateString('sv-SE', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    return `
BRITTA AI - BEKRÄFTELSE AV GODKÄNNANDE

Hej ${fullName},

Tack för att du har godkänt våra användarvillkor och integritetspolicy!
Detta e-postmeddelande bekräftar ditt godkännande och tjänar som din digitala kvittering.

SAMMANFATTNING AV GODKÄNNANDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Namn:              ${fullName}
E-postadress:      ${email}
Godkänt datum:     ${date}
Villkorsversion:   ${termsVersion}

VAD DU HAR GODKÄNT
━━━━━━━━━━━━━━━━━━

Genom att använda Britta AI har du accepterat följande:

• Användarvillkor: Villkor för användning av tjänsten
• Integritetspolicy: Hur vi samlar in, använder och skyddar dina personuppgifter
• AI-ansvarsfriskrivning: Information om AI:ns begränsningar och ditt eget ansvar
• GDPR-rättigheter: Dina rättigheter enligt dataskyddsförordningen

DINA RÄTTIGHETER ENLIGT GDPR
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Du har alltid rätt att:

• Begära utdrag av dina personuppgifter
• Begära rättelse av felaktiga uppgifter
• Begära radering av dina uppgifter ("rätten att bli glömd")
• Invända mot vår behandling av dina uppgifter
• Begära dataportabilitet

LÄNKAR
━━━━━━

Användarvillkor:     https://britta-ai.se/terms.html
Integritetspolicy:  https://britta-ai.se/privacy.html

BEHÖVER DU HJÄLP?
━━━━━━━━━━━━━━━━━

Om du har frågor om dina uppgifter eller vill utöva dina rättigheter,
kontakta oss på: support@britta-ai.se

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BRITTA AI
Detta är ett automatiskt meddelande för att bekräfta ditt godkännande.

© ${new Date().getFullYear()} Britta AI. Alla rättigheter förbehållna.
  `.trim();
}
