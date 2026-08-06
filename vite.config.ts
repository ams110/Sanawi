import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  /*
   * بصمة البناء — لأن التطبيق قشرةٌ تفتح الموقع لا أصولاً محزومة.
   *
   * حين ينشر التدفّق نسخةً جديدة، من كان تطبيقه في الخلفية يستأنفه فيرى
   * الصفحة نفسها المحمَّلة قبل النشر: لا تحميل يقع عند الاستئناف، فتبقى
   * الشيفرة القديمة تعمل ويظنّ صاحبها أن شيئاً لم يتغيّر. وقع هذا فعلاً.
   *
   * فيُحقن رقم البناء في الحزمة، ويُكتب مثله في ملفٍ صغير بجانبها، فيصير
   * سؤال «هل عندي الأحدث؟» قابلاً للجواب من داخل التطبيق.
   */
  const buildId = (process.env.GITHUB_SHA || env.GITHUB_SHA || '').slice(0, 7) || 'dev'

  /*
   * تمرير نداءات Supabase عبر خادم التطوير عند الحاجة.
   *
   * في بيئة تمرّ بوكيل شبكة يفكّ TLS بشهادة موقّعة محلياً، يرفض المتصفح
   * الاتصال بـ ERR_CONNECTION_RESET بينما ينجح Node لأنه يثق بشهادة الوكيل.
   * التمرير يجعل المتصفح يحادث localhost فقط ويتولّى Node الخروج للشبكة،
   * فيصير فحص الواجهة ممكناً دون العبث بمخزن شهادات المتصفح.
   *
   * يُفعَّل فقط حين VITE_SUPABASE_URL نسبيّ (يبدأ بـ /) — أي في الفحص وحده.
   */
  const target = env.SUPABASE_PROXY_TARGET
  const useProxy = env.VITE_SUPABASE_URL?.startsWith('/') && Boolean(target)

  return {
    // الموقع على GitHub Pages يُخدَم من /Sanawi/ لا من الجذر، وداخل التطبيق
    // المغلَّف من الجذر. المتغيّر يفصل الحالتين بلا شرطٍ في الكود.
    base: env.VITE_BASE_PATH || '/',
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    plugins: [
      react(),
      tailwindcss(),
      {
        // ‏`version.json` بجانب الحزمة: أصغر ملفٍ يُسأل عنه بلا تحميل التطبيق كلّه.
        name: 'sanawi-build-id',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: `${JSON.stringify({ build: buildId })}\n`,
          })
        },
      },
    ],
    resolve: {
      alias: { '@': new URL('./src', import.meta.url).pathname },
    },

    /*
     * نقطتا دخول: التطبيق، وصفحة ربط كلود.
     *
     * `connect.html` صفحة مستقلّة بلا React، لكنها تمرّ بالبناء لا بـ `public/`
     * لتأخذ عنوان المشروع ومفتاحه العام عند البناء. صفحةٌ تقرأ عنوان خادم
     * المصادقة من سطر العنوان تصير أداةَ تصيّدٍ جاهزة على نطاقنا.
     */
    build: {
      rollupOptions: {
        input: {
          main: new URL('./index.html', import.meta.url).pathname,
          connect: new URL('./connect.html', import.meta.url).pathname,
        },
      },
    },
    server: useProxy
      ? {
          proxy: {
            [env.VITE_SUPABASE_URL!]: {
              target,
              changeOrigin: true,
              secure: false,
              rewrite: (p) => p.replace(env.VITE_SUPABASE_URL!, ''),
            },
          },
        }
      : undefined,
  }
})
