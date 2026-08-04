import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

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
    plugins: [react(), tailwindcss()],
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
