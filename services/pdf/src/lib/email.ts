import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export type EmailTemplate = 'verify' | 'approved' | 'rejected';
export type Locale = 'ar' | 'en';

interface VerifyVars {
  name: string;
  link: string;
}
interface ApprovedVars {
  name: string;
}
interface RejectedVars {
  name: string;
  reason: string;
}

type VarsFor<T extends EmailTemplate> = T extends 'verify'
  ? VerifyVars
  : T extends 'approved'
    ? ApprovedVars
    : RejectedVars;

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// PII discipline: templates below interpolate ONLY name/link/reason —
// never commercial_registration, VAT number, phone, or anything about the
// applicant's uploaded documents. Keep it that way when adding templates.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const templates: {
  [T in EmailTemplate]: Record<Locale, (vars: VarsFor<T>) => RenderedEmail>;
} = {
  verify: {
    ar: (v: VerifyVars) => ({
      subject: 'تأكيد البريد الإلكتروني — Sanad 360',
      text: `مرحباً ${v.name}،\n\nيرجى تأكيد بريدك الإلكتروني عبر الرابط التالي:\n${v.link}\n\nهذا الرابط صالح لمدة 24 ساعة.`,
      html: `<p>مرحباً ${escapeHtml(v.name)}،</p><p>يرجى تأكيد بريدك الإلكتروني عبر الرابط التالي:</p><p><a href="${v.link}">${escapeHtml(v.link)}</a></p><p>هذا الرابط صالح لمدة 24 ساعة.</p>`,
    }),
    en: (v: VerifyVars) => ({
      subject: 'Confirm your email — Sanad 360',
      text: `Hello ${v.name},\n\nPlease confirm your email using the link below:\n${v.link}\n\nThis link expires in 24 hours.`,
      html: `<p>Hello ${escapeHtml(v.name)},</p><p>Please confirm your email using the link below:</p><p><a href="${v.link}">${escapeHtml(v.link)}</a></p><p>This link expires in 24 hours.</p>`,
    }),
  },
  approved: {
    ar: (v: ApprovedVars) => ({
      subject: 'تمت الموافقة على طلبك — Sanad 360',
      text: `مرحباً ${v.name}،\n\nيسعدنا إبلاغك بأنه تمت الموافقة على طلب انضمامك. يمكنك الآن تسجيل الدخول.`,
      html: `<p>مرحباً ${escapeHtml(v.name)}،</p><p>يسعدنا إبلاغك بأنه تمت الموافقة على طلب انضمامك. يمكنك الآن تسجيل الدخول.</p>`,
    }),
    en: (v: ApprovedVars) => ({
      subject: 'Your application was approved — Sanad 360',
      text: `Hello ${v.name},\n\nYour application has been approved. You can now log in.`,
      html: `<p>Hello ${escapeHtml(v.name)},</p><p>Your application has been approved. You can now log in.</p>`,
    }),
  },
  rejected: {
    ar: (v: RejectedVars) => ({
      subject: 'حالة طلبك — Sanad 360',
      text: `مرحباً ${v.name}،\n\nللأسف لم تتم الموافقة على طلبك.\nالسبب: ${v.reason}`,
      html: `<p>مرحباً ${escapeHtml(v.name)}،</p><p>للأسف لم تتم الموافقة على طلبك.</p><p>السبب: ${escapeHtml(v.reason)}</p>`,
    }),
    en: (v: RejectedVars) => ({
      subject: 'Your application status — Sanad 360',
      text: `Hello ${v.name},\n\nUnfortunately your application was not approved.\nReason: ${v.reason}`,
      html: `<p>Hello ${escapeHtml(v.name)},</p><p>Unfortunately your application was not approved.</p><p>Reason: ${escapeHtml(v.reason)}</p>`,
    }),
  },
};

let client: SESClient | null = null;
function getClient(): SESClient {
  if (!client) {
    const region = process.env.AWS_REGION;
    if (!region) throw new Error('AWS_REGION must be set to send email');
    // Credentials resolved via the SDK's default provider chain — picks up
    // AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY from env automatically if
    // set, or falls back to an attached IAM role (ECS/EC2 task role) if
    // not. Never pass credentials explicitly here.
    client = new SESClient({ region });
  }
  return client;
}

export async function send<T extends EmailTemplate>(
  to: string,
  template: T,
  locale: Locale,
  vars: VarsFor<T>
): Promise<void> {
  const from = process.env.SES_FROM_EMAIL;
  if (!from) throw new Error('SES_FROM_EMAIL must be set to send email');

  const render = templates[template][locale] as (v: VarsFor<T>) => RenderedEmail;
  const { subject, html, text } = render(vars);

  await getClient().send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          Text: { Data: text, Charset: 'UTF-8' },
        },
      },
    })
  );
}
