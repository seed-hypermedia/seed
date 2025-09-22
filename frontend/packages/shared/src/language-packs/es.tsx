import {ReactNode} from 'react'
import {LanguagePack} from '../translation'
import {
  AnyTimestamp,
  formattedDateDayOnly,
  formattedDateLong,
  formattedDateMedium,
  formattedDateShort,
} from '../utils'
import {pluralS} from '../utils/language'

// // Use require to avoid ESM import issues
// const esLocale = require('date-fns/locale/es')
// const es = esLocale.es

const Translations = {
  Close: 'Cerrar',
  version_count: (args: {count: number}) =>
    `${args.count} ${pluralS(args.count, 'versión', 'versiones')}`,
  comment_count: (args: {count: number}) =>
    `${args.count} ${pluralS(args.count, 'comentario', 'comentarios')}`,
  citation_count: (args: {count: number}) =>
    `${args.count} ${pluralS(args.count, 'cita', 'citas')}`,
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
  replying_to: (args: {replyAuthor: ReactNode}) => (
    <>Respondiendo a {args.replyAuthor}</>
  ),
  comment_on: (args: {target: ReactNode}) => <>Comentar en {args.target}</>,
  replies_count: (args: {count: number}) => <>Respuestas ({args.count})</>,
  comment_with_identity: (args: {host: string}) => (
    <>Comentar con {args.host}</>
  ),
  powered_by: (args: {seedLink: ReactNode}) => (
    <>Publicado con {args.seedLink}</>
  ),
  'Notification Settings': 'Configuración de notificaciones',
  Logout: 'Cerrar sesión',
  'Edit Profile': 'Editar perfil',
  'Open App': 'Abrir en Seed',
  Save: 'Guardar',
  'Save Account': 'Guardar Cuenta',
  'Account Name': 'Nombre de la cuenta',
  'Site Icon': 'Icono del sitio',
  'Profile Icon': 'Icono del perfil',
  'Really Logout?': '¿Cerrar sesión?',
  'Log out': 'Cerrar sesión',
  'Log out Forever': 'Cerrar sesión para siempre',
  logout_account_saved:
    'Esta cuenta permanecerá accesible en otros dispositivos.',
  logout_account_not_saved:
    'Esta cuenta no está guardada en ningún otro lugar. Al cerrar sesión, perderás acceso a esta identidad para siempre. Siempre puedes crear una nueva cuenta más tarde.',
  'Email Notification Settings': 'Configuración de Notificaciones por Email',
  'Notification Email': 'Email de notificaciones',
  'Notify me when': 'Notificarme cuando',
  'Someone mentions me': 'Alguien me mencione',
  'Someone replies to me': 'Alguien me responda',
  'Save Notification Settings': 'Guardar Configuración de Notificaciones',
  Cancel: 'Cancelar',
  'You will not receive any notifications.':
    'No recibirás ninguna notificación.',
  'Start a Discussion': 'Comenta',
  'No discussions': 'No hay debates',
  'Be the first to reply': 'Se el primero en responder',
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
  'My New Public Name': 'Mi nuevo nombre público',
  create_account_description:
    'Cuentas de Hypermedia utilizan cryptografía asimétrica. La clave privada de tu cuenta será almacenada de forma segura en este navegador, y nadie más podrá acceder a ella. La identidad será accesible solo en este dominio, pero puedes vincularla a otros dominios y dispositivos más tarde.',
  add: (args: {what: string}) => `Añadir ${args.what}`,
  create_account_title: (args: {siteName: string}) =>
    `Crear cuenta en ${args.siteName}`,
  create_account_submit: (args: {siteName: string}) =>
    `Crear ${args.siteName} cuenta`,
  publish_comment_as: (args: {name: string | undefined}) =>
    args.name ? `Publicar comentario de ${args.name}` : 'Publicar comentario',
  looking_for_document: 'Buscando un documento...',
  hang_tight_searching:
    'Espera un momento, estamos buscando el documento en la red.',
  doc_will_appear:
    'Si el documento está disponible, aparecerá pronto. Gracias por tu paciencia!',
  'Document Not Found': 'Documento no encontrado',
  oops_document_not_found: `Oops! El documento que buscas no parece existir. Puede que haya sido movido, eliminado o el enlace sea incorrecto.`,
  please_double_check_url: `Por favor, verifica la URL o regresa al panel de control para encontrar lo que buscas. Si necesitas ayuda, no dudes en contactar a soporte.`,
  'Copy Comment Link': 'Copiar enlace de comentario',
  'Internal Server Error': 'Error interno del servidor',
  error_no_daemon_connection:
    'No hay conexión con el backend. Seguramente es un bug en nuestro código. Por favor, háznoslo saber!',

  // I can't figure out how to get the error page translated...
  // "Uh oh, it's not you, it's us...": 'Uh oh, no es tu culpa, es nuestra...',
}

const Spanish: LanguagePack = {
  // @ts-expect-error
  translations: Translations,
  formattedDateShort: (date: AnyTimestamp) => {
    return formattedDateShort(
      date,
      //{locale: es}
    )
  },
  formattedDateLong: (date: AnyTimestamp) => {
    return formattedDateLong(
      date,
      //{locale: es}
    )
  },
  formattedDateMedium: (date: AnyTimestamp) => {
    return formattedDateMedium(
      date,
      //{locale: es}
    )
  },
  formattedDateDayOnly: (date: AnyTimestamp) => {
    return formattedDateDayOnly(
      date,
      //{locale: es}
    )
  },
}
export default Spanish
