import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Email template function
function generateConsentEmailHTML(params: {
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
  <title>Bekräftelse - Britta AI</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5; color: #333; }
    .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; color: white; }
    .header h1 { margin: 0 0 10px 0; font-size: 28px; }
    .content { padding: 40px 30px; }
    .summary-box { background: #f8f9fa; border-left: 4px solid #667eea; padding: 20px; margin: 20px 0; border-radius: 4px; }
    .summary-item { margin: 10px 0; display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e9ecef; }
    .button { display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 6px; margin: 10px 5px; }
    .footer { background: #f8f9fa; padding: 30px; text-align: center; font-size: 14px; color: #666; }
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
      <p>Tack för att du har godkänt våra användarvillkor och integritetspolicy!</p>
      <div class="summary-box">
        <h2>Sammanfattning</h2>
        <div class="summary-item"><span>Namn:</span><span>${fullName}</span></div>
        <div class="summary-item"><span>E-post:</span><span>${email}</span></div>
        <div class="summary-item"><span>Datum:</span><span>${date}</span></div>
        <div class="summary-item"><span>Version:</span><span>${termsVersion}</span></div>
      </div>
      <div style="text-align: center; margin: 30px 0;">
        <a href="https://britta-ai.se/terms.html" class="button">Användarvillkor</a>
        <a href="https://britta-ai.se/privacy.html" class="button">Integritetspolicy</a>
      </div>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Britta AI</p>
    </div>
  </div>
</body>
</html>`;
}

serve(async (req) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse request body
    const { userId, email, fullName, termsVersion, acceptedAt } = await req.json();

    // Validate required fields
    if (!userId || !email || !fullName || !termsVersion || !acceptedAt) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Sending consent email to ${email} for user ${userId}`);

    // Initialize Supabase client with service role key for admin access
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Rate limiting: Check if user recently received an email
    const { data: profile } = await supabase
      .from('profiles')
      .select('consent_email_sent_at')
      .eq('id', userId)
      .single();

    if (profile?.consent_email_sent_at) {
      const lastSent = new Date(profile.consent_email_sent_at);
      const minutesSinceLastEmail = (Date.now() - lastSent.getTime()) / 1000 / 60;

      if (minutesSinceLastEmail < 5) {
        console.log(`Rate limit hit for user ${userId}: Last email sent ${minutesSinceLastEmail.toFixed(1)} minutes ago`);
        return new Response(
          JSON.stringify({
            error: 'Too many requests. Please wait before requesting another email.',
            retryAfter: Math.ceil(5 - minutesSinceLastEmail)
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }


    // Get Resend API key
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }

    // Generate email HTML
    const emailHtml = generateConsentEmailHTML({
      fullName,
      acceptedAt,
      termsVersion,
      email
    });

    // Send email via Resend API
    console.log('Sending email via Resend...');
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Britta AI <onboarding@resend.dev>', // Use your verified domain or Resend's test domain
        to: [email],
        subject: 'Bekräftelse av godkännande - Britta AI',
        html: emailHtml
      })
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('Resend API error:', resendData);
      throw new Error(`Failed to send email: ${resendData.message || 'Unknown error'}`);
    }

    console.log('Email sent successfully via Resend:', resendData.id);

    // Update profile to mark email as sent
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        consent_email_sent: true,
        consent_email_sent_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating profile:', updateError);
      // Don't fail the request - email was sent successfully
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Consent email sent successfully',
        emailId: resendData.id
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in send-consent-email function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
