#!/usr/bin/env node
/**
 * خادم MCP لسنوي.
 *
 * يربط التطبيق بكلود: بدل فتح الشاشة لتسجيل إيداع أو معرفة القسط، يسأل
 * المستخدم بلغته ويقرأ كلود من الحساب نفسه ويكتب فيه.
 *
 * ثلاث قواعد بُني عليها هذا الخادم:
 *
 * 1. الحارس هو RLS نفسه. ندخل بحساب المستخدم عبر المفتاح العام لا بمفتاح
 *    خدمة يتجاوز السياسات، فلا يرى الخادم إلا ما يراه المستخدم في شاشته.
 * 2. الحساب من مصدر واحد. الأقساط والتقويم والتجديد تخرج من `src/lib/**`
 *    نفسها التي تغذّي الواجهة — لا نسخة ثانية تنحرف عنها بعد أول تعديل.
 * 3. لا حذف. الأرشفة بدل الحذف، والسحب بقيدٍ سالب: تاريخ من دفع ماذا لا يُمحى
 *    بنداء أداة.
 *
 * التشغيل: stdio — العميل يشغّل العملية ويحادثها عبر المدخل والمخرج القياسيين.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ConfigError, createSession, readConfig } from './session.js'
import { registerReadTools } from './tools/read.js'
import { registerWriteTools } from './tools/write.js'

async function main(): Promise<void> {
  const config = readConfig()
  const connect = createSession(config)

  const server = new McpServer(
    { name: 'sanawi-mcp-server', version: '1.0.0' },
    {
      instructions:
        'سنوي: تطبيق يحوّل الالتزامات السنوية الكبيرة إلى أقساط شهرية يدفعها المستخدم لنفسه.\n' +
        'ابدأ من sanawi_month_overview لأي سؤال عن الوضع العام، ومن sanawi_list_obligations ' +
        'لأي سؤال عن بند بعينه. الأدوات تقبل أسماء الالتزامات والمجموعات كما ينطقها المستخدم، ' +
        'فلا حاجة لجلب المعرّفات أولاً.\n' +
        'الأرقام تخرج من محرّك حسابات التطبيق نفسه — لا تعِد حسابها، واقتبسها كما وصلت.\n' +
        'العملة في حقل currency من كل رد؛ لا تفترض عملةً غيرها.\n' +
        'قبل sanawi_mark_paid تأكّد أن المستخدم يقصد دفع الالتزام لا مجرد إيداع في صندوقه.',
    },
  )

  registerReadTools(server, connect)

  // الأدوات غير المسجّلة لا يمكن استدعاؤها: هذا ما يجعل وضع القراءة ضماناً
  // لا وعداً في التوثيق.
  if (!config.readOnly) registerWriteTools(server, connect)

  await server.connect(new StdioServerTransport())

  // stdout محجوز لبروتوكول MCP — أي طباعة فيه تفسد الرسائل. السجلّ في stderr.
  console.error(
    `خادم سنوي يعمل عبر stdio${config.readOnly ? ' — وضع القراءة فقط' : ''} (${config.email}).`,
  )
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message)
    process.exit(1)
  }
  console.error('تعذّر تشغيل خادم سنوي:', error instanceof Error ? error.message : error)
  process.exit(1)
})
