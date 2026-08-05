#!/bin/bash
#
# تجهيز الجلسة على كلود كود ويب.
#
# الحاوية تُنشأ من نسخةٍ طازجة بلا `node_modules`، فأول أمرٍ يكتبه الوكيل —
# `npx vitest run` أو `npm run lint` — يفشل بـ «Cannot find package 'vite'»
# لا بخطأٍ في الكود. هذا الملف يجعل الفشل مستحيلاً: الاعتماديات تُنصَّب قبل
# أن تبدأ الجلسة، فما يفشل بعدها يفشل لسببٍ حقيقي.
#
# متزامن لا غير متزامن عن قصد: بدء الجلسة يتأخّر قليلاً، والبديل سباقٌ
# يقرأ فيه الوكيل مجلّداً نصف منصَّب فيرى أخطاءً لا وجود لها.

set -euo pipefail

# محلياً الاعتماديات موجودة أصلاً، ولا داعي لأن يدفع أحدٌ ثمن هذا على جهازه.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# `install` لا `ci`: حالة الحاوية تُحفَظ بعد انتهاء هذا الملف، و`ci` تمحو
# `node_modules` كاملاً في كل مرة فتُبطل الفائدة من الحفظ.
echo "تنصيب اعتماديات npm…"
npm install --no-audit --no-fund

# المتصفّح منصَّب في الصورة و PLAYWRIGHT_BROWSERS_PATH مضبوط، فلا
# `playwright install` هنا: تنزيلٌ بمئات الميغابايت لنسخةٍ موجودة أصلاً.

# `mcp/dist` خارج git، فبلا هذه الخطوة يفشل `npm run check:mcp` — وهو أحد
# فحوص التدفّق — بمجلّدٍ مفقود لا بعطلٍ في الخادم.
echo "بناء خادم MCP…"
npm run build:mcp

echo "جاهز: npx vitest run · npm run lint · npm run check:mcp"
