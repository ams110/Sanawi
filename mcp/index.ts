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

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ConfigError, createSession, readConfig } from './session.js'
import { createSanawiServer } from './server.js'

async function main(): Promise<void> {
  const config = readConfig()
  const server = createSanawiServer(config, createSession(config))

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
