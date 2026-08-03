import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.sanawi.app',
  appName: 'سنوي',
  webDir: 'dist',
  /*
   * التطبيق يحمّل واجهته من الموقع المنشور لا من الأصول المحزومة.
   *
   * العنوان دومين مخصّص لا `ams110.github.io/Sanawi/`: الأخير يردّ 301 إلى
   * الدومين المخصّص، وتوفير قفزةٍ عند كل فتح خيرٌ من دفعها.
   *
   * بهذا تصل كل ميزة جديدة بإعادة تحميل، بلا تنصيب APK. التنازل أن التطبيق
   * لا يفتح بلا إنترنت — وهو تنازل نظري هنا: كل رقم فيه يأتي من Supabase،
   * فبلا إنترنت هو معطّل أصلاً محزوماً كان أو لا.
   *
   * ما يزال بناء APK لازماً حين تتغيّر الإضافات الأصلية أو الأذونات أو
   * الأيقونة — أي ما يمسّ النظام لا الواجهة.
   */
  server: {
    url: 'https://sanawi.kabblan.com/',
    cleartext: false,
  },
  android: {
    // الويب داخل التطبيق يجب أن يبقى بخلفية التطبيق لا بيضاء:
    // الوميض الأبيض عند كل فتح يجعل التطبيق يبدو بطيئاً وهو ليس كذلك.
    backgroundColor: '#FAF8F3',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: '#FAF8F3',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
  },
}

export default config
