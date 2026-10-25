import { Injectable, Logger, BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/**
 * Servicio de correo con 2 drivers configurables vía MAIL_DRIVER:
 *  - "log"    → imprime el correo en consola (ideal para desarrollo, sin configurar nada)
 *  - "resend" → envía por la API de Resend (necesita RESEND_API_KEY)
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null = null;

  constructor(private readonly config: ConfigService) {
    const driver = this.config.get<string>('mail.driver') ?? 'log';
    const apiKey = this.config.get<string>('mail.resendApiKey');

    if (driver === 'resend' && apiKey) {
      this.resend = new Resend(apiKey);
    }
  }

  /**
   * Envía el código de recuperación de contraseña.
   * Lanza BadGatewayException si el envío real falla (para que el caller
   * pueda avisar al usuario sin filtrar si el correo existe o no).
   */
  sendPasswordResetCode(to: string, name: string, code: string) {
    return this.sendCode(
      to,
      'Tu código de recuperación — Zentro',
      buildResetCodeHtml(name, code, RESET_COPY),
      `Código de recuperación: ${code}`,
    );
  }

  /** Envía el código para verificar el correo de la cuenta. */
  sendEmailVerificationCode(to: string, name: string, code: string) {
    return this.sendCode(
      to,
      'Verifica tu correo — Zentro',
      buildResetCodeHtml(name, code, VERIFY_COPY),
      `Código de verificación: ${code}`,
    );
  }

  /** Aviso de seguridad (2FA activada/desactivada…). Best-effort: no lanza. */
  async sendSecurityNotice(
    to: string,
    name: string,
    title: string,
    body: string,
  ) {
    const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111">
<p>Hola ${escapeHtml(name)},</p>
<h2 style="font-size:18px">${escapeHtml(title)}</h2>
<p style="color:#444">${escapeHtml(body)}</p>
<p style="color:#888;font-size:12px">Si no fuiste tú, cambia tu contraseña de inmediato y escríbenos.</p>
</div>`;
    try {
      await this.sendCode(to, `${title} — Zentro`, html, title);
    } catch {
      this.logger.warn(`No se pudo enviar el aviso de seguridad a ${to}`);
    }
  }

  private async sendCode(
    to: string,
    subject: string,
    html: string,
    logLine: string,
  ): Promise<void> {
    const driver = this.config.get<string>('mail.driver') ?? 'log';
    const from = `${this.config.get<string>('mail.fromName')} <${this.config.get<string>('mail.fromEmail')}>`;

    if (driver === 'resend' && this.resend) {
      const { error } = await this.resend.emails.send({
        from,
        to,
        subject,
        html,
      });

      if (error) {
        this.logger.error(`Resend error: ${JSON.stringify(error)}`);
        throw new BadGatewayException(
          'No pudimos enviar el correo. Inténtalo de nuevo.',
        );
      }
      return;
    }

    // Driver "log": desarrollo sin infraestructura de correo
    this.logger.log(`[MAIL LOG] Para: ${to} | ${logLine}`);
  }

  /**
   * Notifica al equipo de Zentro que llegó un mensaje del formulario
   * de contacto de la landing. Best-effort: el caller no debe fallar
   * si el correo no se puede entregar (el mensaje ya está en BD).
   */
  async sendContactNotification(msg: {
    id: string;
    topic: string;
    name: string;
    email: string;
    organization: string | null;
    phone: string | null;
    message: string;
  }): Promise<void> {
    const driver = this.config.get<string>('mail.driver') ?? 'log';
    const from = `${this.config.get('mail.fromName')} <${this.config.get('mail.fromEmail')}>`;
    const to =
      this.config.get<string>('mail.contactTo') ?? 'usezentroapp@gmail.com';
    const subject = `Nuevo mensaje de contacto — Zentro [${msg.topic}]`;

    if (driver === 'resend' && this.resend) {
      const { error } = await this.resend.emails.send({
        from,
        to,
        subject,
        html: buildContactHtml(msg),
      });

      if (error) {
        this.logger.error(`Resend error: ${JSON.stringify(error)}`);
        throw new BadGatewayException(
          'No se pudo enviar la notificación de contacto.',
        );
      }
      return;
    }

    // Driver "log": desarrollo sin infraestructura de correo
    this.logger.log(
      `[MAIL LOG] Contacto de ${msg.name} <${msg.email}> [${msg.topic}]: ${msg.message.slice(0, 120)}`,
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildContactHtml(msg: {
  topic: string;
  name: string;
  email: string;
  organization: string | null;
  phone: string | null;
  message: string;
}): string {
  const rows: Array<[string, string]> = [
    ['Motivo', msg.topic],
    ['Nombre', msg.name],
    ['Correo', msg.email],
    ['Empresa', msg.organization ?? '—'],
    ['Teléfono', msg.phone ?? '—'],
  ];

  const rowHtml = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 16px;font-size:13px;color:#8a857d;border-bottom:1px solid #e5e2de;">${label}</td>
          <td style="padding:8px 16px;font-size:14px;color:#1c1917;border-bottom:1px solid #e5e2de;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
      <body style="margin:0;padding:0;background:#f6f5f4;font-family:Arial,Helvetica,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f4;padding:32px 16px;">
          <tr><td align="center">
            <table role="presentation" style="max-width:560px;background:#ffffff;border:1px solid #e5e2de;border-radius:16px;overflow:hidden;">
              <tr>
                <td style="padding:28px 28px 12px 28px;">
                  <h1 style="margin:0 0 4px 0;font-size:20px;color:#1c1917;">Nuevo mensaje de contacto</h1>
                  <p style="margin:0;font-size:13px;color:#8a857d;">Formulario de la landing de Zentro</p>
                </td>
              </tr>
              <tr>
                <td style="padding:0 28px 8px 28px;">
                  <table style="width:100%;border-collapse:collapse;border:1px solid #e5e2de;border-radius:8px;overflow:hidden;">
                    ${rowHtml}
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 28px 28px 28px;">
                  <p style="margin:0 0 8px 0;font-size:13px;color:#8a857d;">Mensaje:</p>
                  <p style="margin:0;padding:16px;background:#f6f5f4;border-radius:8px;font-size:14px;line-height:1.6;color:#44403c;white-space:pre-wrap;">${escapeHtml(msg.message)}</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
    </html>
  `;
}

interface CodeEmailCopy {
  title: string;
  intro: string;
  footer: string;
}

const RESET_COPY: CodeEmailCopy = {
  title: 'Recupera tu contraseña',
  intro:
    'Usa este código para restablecer tu contraseña en Zentro. Expira en 15 minutos.',
  footer:
    'Si no solicitaste este código, puedes ignorar este correo. Tu contraseña no cambiará.',
};

const VERIFY_COPY: CodeEmailCopy = {
  title: 'Verifica tu correo',
  intro:
    'Usa este código para confirmar que este correo es tuyo. Expira en 15 minutos.',
  footer: 'Si no fuiste tú, puedes ignorar este correo.',
};

function buildResetCodeHtml(
  name: string,
  code: string,
  copy: CodeEmailCopy = RESET_COPY,
): string {
  return `
    <!DOCTYPE html>
    <html>
      <body style="margin:0;padding:0;background:#f6f5f4;font-family:Arial,Helvetica,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f4;padding:32px 16px;">
          <tr><td align="center">
            <table role="presentation" width="100%" max-width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e5e2de;border-radius:16px;overflow:hidden;">
              <tr>
                <td style="padding:32px 32px 8px 32px;">
                  <p style="margin:0;font-size:14px;color:#8a857d;">Hola ${escapeHtml(name)},</p>
                  <h1 style="margin:8px 0 0 0;font-size:22px;color:#1c1917;">${copy.title}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 32px 24px 32px;">
                  <p style="margin:0;font-size:15px;line-height:1.6;color:#44403c;">
                    ${copy.intro}
                  </p>
                  <div style="margin:24px 0;padding:20px;background:#f6f5f4;border-radius:12px;text-align:center;">
                    <span style="font-size:34px;font-weight:700;letter-spacing:8px;color:#1c1917;">${code}</span>
                  </div>
                  <p style="margin:0;font-size:13px;line-height:1.6;color:#8a857d;">
                    ${copy.footer}
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 32px 24px 32px;border-top:1px solid #e5e2de;">
                  <p style="margin:0;font-size:12px;color:#a8a29e;">Zentro — Tu negocio, un solo sistema.</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
    </html>
  `;
}
