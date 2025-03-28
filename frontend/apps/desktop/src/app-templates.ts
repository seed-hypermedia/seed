const devTemplates = {
  blog: 'z6Mkv1SrE6LFGkYKxZs33qap5MSQGbk41XnLdMu7EkKy3gv2',
  documentation: 'z6Mkk4LFMaccittZNsRiE1VPuzaZYWu5QnpUtQHsMLnrr7tN',
}

const prodTemplates = {
  blog: 'z6MkrvMBtbQHQX1YyYE9k5oNcTURbV9fPr4UPencXcLG1Y4X',
  documentation: 'z6MkjcZ1VbmV7oqzXnACizhgEZwT9kjtaN7dUicwSZ3qSkmU',
}

export const templates = prodTemplates
// export const templates =
//   IS_PROD_DESKTOP && !IS_PROD_DEV ? prodTemplates : devTemplates

// if (IS_PROD_DESKTOP && !IS_PROD_DEV) {
//   console.log('========= USING PRODUCTION TEMPLATES ========')
//   console.log(templates)
// } else {
//   console.log('========= USING DEV TEMPLATES ========')
//   console.log(templates)
// }
