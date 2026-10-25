import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateContactDto } from './dto/create-contact.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Guarda un mensaje del formulario de contacto de la landing.
   * La persistencia en BD es la fuente de verdad; la notificación
   * por correo es best-effort y no bloquea la respuesta.
   */
  async create(dto: CreateContactDto) {
    const saved = await this.prisma.contactMessage.create({
      data: {
        topic: dto.topic,
        name: dto.name,
        email: dto.email,
        organization: dto.organization?.trim() || null,
        phone: dto.phone?.trim() || null,
        message: dto.message,
      },
    });

    try {
      await this.mail.sendContactNotification(saved);
    } catch (error) {
      this.logger.warn(
        `Mensaje ${saved.id} guardado, pero falló la notificación por correo: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    this.logger.log(
      `Nuevo mensaje de contacto [${saved.topic}] de ${saved.name} <${saved.email}>`,
    );

    return { ok: true, id: saved.id };
  }
}
