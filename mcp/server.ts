/**
 * تركيب الخادم — مشترك بين النقلين.
 *
 * `stdio` يشغّله عميلٌ على جهاز، و`http` يعيش على رابط بعيد. الفرق بينهما نقلٌ
 * لا منطق، فالأدوات وتعليماتها تُبنى هنا مرة واحدة ولا تتفرّع نسختين تنحرفان.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Config, Connection } from './session.js'
import { registerReadTools } from './tools/read.js'
import { registerWriteTools } from './tools/write.js'

export const SERVER_INFO = { name: 'sanawi-mcp-server', version: '1.1.0' } as const

const INSTRUCTIONS =
  'سنوي: تطبيق يحوّل الالتزامات السنوية الكبيرة إلى أقساط شهرية يدفعها المستخدم لنفسه.\n' +
  'ابدأ من sanawi_month_overview لأي سؤال عن الوضع العام، ومن sanawi_list_obligations ' +
  'لأي سؤال عن بند بعينه. الأدوات تقبل أسماء الالتزامات والمجموعات كما ينطقها المستخدم، ' +
  'فلا حاجة لجلب المعرّفات أولاً.\n' +
  'الأرقام تخرج من محرّك حسابات التطبيق نفسه — لا تعِد حسابها، واقتبسها كما وصلت.\n' +
  'العملة في حقل currency من كل رد؛ لا تفترض عملةً غيرها.\n' +
  'قبل sanawi_mark_paid تأكّد أن المستخدم يقصد دفع الالتزام لا مجرد إيداع في صندوقه.'

export function createSanawiServer(
  config: Config,
  connect: () => Promise<Connection>,
): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS })

  registerReadTools(server, connect)

  // الأدوات غير المسجّلة لا يمكن استدعاؤها: هذا ما يجعل وضع القراءة ضماناً
  // لا وعداً في التوثيق.
  if (!config.readOnly) registerWriteTools(server, connect)

  return server
}
