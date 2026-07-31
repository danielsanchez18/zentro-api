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
  async sendPasswordResetCode(to: string, name: string, code: string): Promise<void> {
    const driver = this.config.get<string>('mail.driver') ?? 'log';
    const from = `${this.config.get<string>('mail.fromName')} <${this.config.get<string>('mail.fromEmail')}>`;

    if (driver === 'resend' && this.resend) {
      const { error } = await this.resend.emails.send({
        from,
        to,
        subject: 'Tu código de recuperación — Zentro',
        html: buildResetCodeHtml(name, code),
      });

      if (error) {
        this.logger.error(`Resend error: ${JSON.stringify(error)}`);
        throw new BadGatewayException('No pudimos enviar el correo. Inténtalo de nuevo.');
      }
      return;
    }

    // Driver "log": desarrollo sin infraestructura de correo
    this.logger.log(`[MAIL LOG] Para: ${to} | Código de recuperación: ${code}`);
  }
}

function buildResetCodeHtml(name: string, code: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <body style="margin:0;padding:0;background:#f6f5f4;font-family:Arial,Helvetica,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f4;padding:32px 16px;">
          <tr><td align="center">
            <table role="presentation" width="100%" max-width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e5e2de;border-radius:16px;overflow:hidden;">
              <tr>
                <td style="padding:32px 32px 8px 32px;">
                  <p style="margin:0;font-size:14px;color:#8a857d;">Hola ${name},</p>
                  <h1 style="margin:8px 0 0 0;font-size:22px;color:#1c1917;">Recupera tu contraseña</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 32px 24px 32px;">
                  <p style="margin:0;font-size:15px;line-height:1.6;color:#44403c;">
                    Usa este código para restablecer tu contraseña en Zentro. Expira en 15 minutos.
                  </p>
                  <div style="margin:24px 0;padding:20px;background:#f6f5f4;border-radius:12px;text-align:center;">
                    <span style="font-size:34px;font-weight:700;letter-spacing:8px;color:#1c1917;">${code}</span>
                  </div>
                  <p style="margin:0;font-size:13px;line-height:1.6;color:#8a857d;">
                    Si no solicitaste este código, puedes ignorar este correo. Tu contraseña no cambiará.
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
