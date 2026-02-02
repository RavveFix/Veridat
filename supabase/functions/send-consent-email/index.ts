/// <reference path="../../types/deno.d.ts" />

import { createClient } from '@supabase/supabase-js';
import { getCorsHeaders, createOptionsResponse } from "../../services/CorsService.ts";
import { createLogger } from "../../services/LoggerService.ts";

const logger = createLogger('send-consent-email');

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Email template function
function generateConsentEmailHTML(params: {
  fullName: string;
  acceptedAt: string;
  termsVersion: string;
  email: string;
}): string {
  const fullName = escapeHtml(params.fullName);
  const acceptedAt = params.acceptedAt;
  const termsVersion = escapeHtml(params.termsVersion);
  const email = escapeHtml(params.email);
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
  <title>Bekräftelse - Veridat</title>
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
      <h1>🤖 Veridat</h1>
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
        <a href="https://veridat.se/terms.html" class="button">Användarvillkor</a>
        <a href="https://veridat.se/privacy.html" class="button">Integritetspolicy</a>
      </div>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Veridat</p>
    </div>
  </div>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders();

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return createOptionsResponse();
  }

  try {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client with service role key for admin access
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve actual user id from the access token (don’t trust client-provided IDs)
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const bodyFullName = typeof body['fullName'] === 'string' ? body['fullName'] : '';
    const bodyTermsVersion = typeof body['termsVersion'] === 'string' ? body['termsVersion'] : '';
    const bodyAcceptedAt = typeof body['acceptedAt'] === 'string' ? body['acceptedAt'] : '';

    const userId = user.id;
    const email = user.email;
    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email saknas för användaren' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logger.info('Sending consent email', { userId });

    // Rate limiting: Check if user recently received an email
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('full_name, has_accepted_terms, terms_accepted_at, terms_version, consent_email_sent_at')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      logger.warn('Profile not found when sending consent email', { userId, error: profileError?.message });
      return new Response(
        JSON.stringify({ error: 'Profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!profile.has_accepted_terms) {
      return new Response(
        JSON.stringify({ error: 'Terms not accepted' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (profile?.consent_email_sent_at) {
      const lastSent = new Date(profile.consent_email_sent_at);
      const minutesSinceLastEmail = (Date.now() - lastSent.getTime()) / 1000 / 60;

      if (minutesSinceLastEmail < 5) {
        logger.warn('Consent email rate limit hit', { userId, minutesSinceLastEmail: Number(minutesSinceLastEmail.toFixed(1)) });
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
    const fullName = profile.full_name || bodyFullName || 'Kund';
    const termsVersion = profile.terms_version || bodyTermsVersion || 'okänd';
    const acceptedAt = profile.terms_accepted_at || bodyAcceptedAt || new Date().toISOString();

    const emailHtml = generateConsentEmailHTML({
      fullName,
      acceptedAt,
      termsVersion,
      email: email
    });

    // Send email via Resend API
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Veridat <onboarding@resend.dev>', // Use your verified domain or Resend's test domain
        to: [email],
        subject: 'Bekräftelse av godkännande - Veridat',
        html: emailHtml
      })
    });

    const resendData = (await resendResponse.json().catch(() => ({}))) as Record<string, unknown>;
    const resendId = typeof resendData['id'] === 'string' ? resendData['id'] : undefined;

    if (!resendResponse.ok) {
      const resendMessage = typeof resendData['message'] === 'string' ? resendData['message'] : 'Unknown error';
      logger.error('Resend API error', resendMessage, { userId, status: resendResponse.status });
      throw new Error(`Failed to send email: ${resendMessage}`);
    }

    logger.info('Consent email sent', { userId, emailId: resendId });

    // Update profile to mark email as sent
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        consent_email_sent: true,
        consent_email_sent_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      logger.warn('Error updating profile after sending consent email', { userId, error: updateError.message });
      // Don't fail the request - email was sent successfully
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Consent email sent successfully',
        emailId: resendId
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    logger.error('Error in send-consent-email function', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
