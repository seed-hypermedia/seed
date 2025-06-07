import {es} from 'date-fns/locale/es'
import {ReactNode} from 'react'
import {LanguagePack} from '../translation'
import {
  AnyTimestamp,
  formattedDateDayOnly,
  formattedDateLong,
  formattedDateMedium,
  formattedDateShort,
} from '../utils'

const Translations = {
  Activity: 'Actividad',
  Discussions: 'Discusiones',
  'Start a Comment': 'Inicia un debate',
  Reply: 'Responder',
  'current version': 'versión actual',
  version: 'versión',
  Citations: 'Citas',
  'All Citations': 'Todas Citas',
  'All Discussions': 'Todos Debates',
  'cited on': 'citado en',
  Versions: 'Versiones',
  'Last Update': 'Última actualización',
  'Original Publish date': 'Fecha de publicación original',
  replying_to: (args: {replyAuthor: ReactNode}) =>
    `Respondiendo a ${args.replyAuthor}`,
  comment_on: (args: {target: ReactNode}) => `Comentar en ${args.target}`,
  replies_count: (args: {count: number}) => `Respuestas (${args.count})`,
  comment_with_identity: (args: {host: string}) => `Comentar con ${args.host}`,
  powered_by: (args: {seedLink: ReactNode}) => `Publicado con ${args.seedLink}`,
  'Notification Settings': 'Configuración de notificaciones',
  Logout: 'Cerrar sesión',
  'Edit Profile': 'Editar perfil',
  'Open App': 'Abrir en Seed',
  'Save Account': 'Guardar Cuenta',
  'Account Name': 'Nombre de la cuenta',
  'Site Icon': 'Icono del sitio',
  'Really Logout?': '¿Cerrar sesión?',
  'Log out': 'Cerrar sesión',
  'Log out Forever': 'Cerrar sesión para siempre',
  logout_account_saved:
    'Esta cuenta permanecerá accesible en otros dispositivos.',
  logout_account_not_saved:
    'Esta cuenta no está guardada en ningún otro lugar. Al cerrar sesión, perderás acceso a esta identidad para siempre.',
  'Email Notification Settings': 'Configuración de Notificaciones por Email',
  'Notification Email': 'Email de notificaciones',
  'Notify me when': 'Notificarme cuando',
  'Someone mentions me': 'Alguien me mencione',
  'Someone replies to me': 'Alguien me responda',
  'Save Notification Settings': 'Guardar Configuración de Notificaciones',
  Cancel: 'Cancelar',
  'You will not receive any notifications.':
    'No recibirás ninguna notificación.',
  'Start a discussion': 'Iniciar un debate',
  'No discussions': 'No hay debates',
  version_from: (args: {date: string}) => `Versión del ${args.date}`,
  'Go to Latest': 'Ir a Última',
  copy_block_range: 'Copiar rango de bloques',
  copy_block_exact: 'Copiar enlace de bloque (Versión exacta)',
  'Comment on this block': 'Comentar en este bloque',
  block_comment_count: (args: {count: number}) =>
    `${args.count} ${args.count === 1 ? 'comentario' : 'comentarios'}`,
  block_citation_count: (args: {count: number}) =>
    `${args.count} ${args.count === 1 ? 'cita' : 'citas'} en este bloque`,
  Collapse: 'Colapsar',
  Expand: 'Expandir',
  collapse_block: 'Puedes colapsar este bloque y ocultar sus hijos',
  block_is_collapsed:
    'Este bloque está colapsado. Puedes expandirlo y ver sus hijos',
}

const Spanish: LanguagePack = {
  translations: Translations,
  formattedDateShort: (date: AnyTimestamp) => {
    return formattedDateShort(date, {locale: es})
  },
  formattedDateLong: (date: AnyTimestamp) => {
    return formattedDateLong(date, {locale: es})
  },
  formattedDateMedium: (date: AnyTimestamp) => {
    return formattedDateMedium(date, {locale: es})
  },
  formattedDateDayOnly: (date: AnyTimestamp) => {
    return formattedDateDayOnly(date, {locale: es})
  },
}
export default Spanish
