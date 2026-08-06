import { renewAfterPayment, type RenewalInput, type RenewalResult } from './renewal.js'

/**
 * ماذا يحدث حين يُدفع الالتزام — كل أثره، في مكانٍ واحد.
 *
 * كان لهذا الفعل مساران يكتبان تاريخين ماليين مختلفين في قاعدةٍ واحدة:
 *
 * • من الشاشة: يُفرَّغ الصندوق ويُقدَّم الموعد، **ولا يُمسّ رصيد أيّ حساب ولا
 *   تُفتح تسوية**. فبعد أكبر دفعةٍ في السنة يقفز «غير مخصّص» بمقدار ما خرج
 *   بالضبط — والتطبيق يَعِد بمالٍ خرج من البنك قبل دقيقة. وهو بعينه العطل
 *   الذي بُني ذلك الرقم ليكشفه.
 *
 * • من كلود: يُنقص الرصيد بما خرج فعلاً، وتُفتح تسوية إن كان حساب الدفع غير
 *   حساب الصندوق.
 *
 * والسبب أن `renewAfterPayment` — وهي المشتركة — تجيب عن **الصندوق** وحده،
 * وما وراءه تُرك لكل مستدعٍ يكتبه بنفسه. فكتبه أحدهما وتركه الآخر.
 *
 * فهذا الملف يجيب عن الأثر كلّه: ماذا يخرج من أيّ حساب، ومَن يصير مديناً لمن.
 * والتنفيذ يبقى عند كل عميل — لأن أحدهما يكتب بعميل المتصفّح والآخر بجلسة
 * الخادم — لكن **القرار واحد**، فيستحيل أن يفترقا ثانيةً.
 *
 * ملف نقي: لا React ولا Supabase ولا ترجمة.
 */

export interface PaymentPlanInput extends RenewalInput {
  /** الحساب الذي يحتفظ بصندوق هذا الالتزام، أو null إن كان غير مربوط. */
  fundAccountId?: string | null
  /** الحساب الذي خرج منه الدفع. الافتراضي حساب الصندوق. */
  paidFromAccountId?: string | null
}

export interface PendingSettlement {
  /** الحساب الذي تحرّر ماله — حساب الصندوق. */
  debtorAccountId: string
  /** الحساب الذي خرج منه الدفع فعلاً. */
  creditorAccountId: string
  amount: number
}

export interface PaymentPlan {
  renewal: RenewalResult
  /**
   * ما خرج من البنك فعلاً: ما جمعه الصندوق زائد ما غُطّي من الجيب.
   *
   * وخصمُ `amountPaid` وحده — وهو ما يغري لأنه الرقم الظاهر — يترك الرصيد
   * أعلى من الحقيقة بمقدار النقص، أي أن التطبيق يَعِد بمالٍ أُنفق فعلاً.
   */
  withdrawn: number
  /** الحساب الذي يُنقص رصيده بـ`withdrawn`، أو null فلا يُمسّ رصيد. */
  chargeAccountId: string | null
  /**
   * تسويةٌ معلّقة حين يختلف حساب الدفع عن حساب الصندوق.
   *
   * مقدارها `amountPaid` لا `withdrawn`: ما تحرّر في حساب الصندوق هو ما كان
   * فيه، والنقص المغطّى من الجيب لم يكن فيه أصلاً فلا يُطالَب به.
   */
  settlement: PendingSettlement | null
}

const round2 = (n: number): number => Math.round(n * 100) / 100

export function planPayment(input: PaymentPlanInput): PaymentPlan {
  const renewal = renewAfterPayment(input)

  const fundAccountId = input.fundAccountId ?? null
  // من لم يقل من أين دفع دفع من حيث جمع.
  const chargeAccountId = input.paidFromAccountId ?? fundAccountId

  const withdrawn = round2(renewal.amountPaid + renewal.shortfall)

  /*
   * الدفع من حسابٍ غير حساب الصندوق يُقبل ويُعلَّم.
   *
   * هذا ما يحدث فعلاً حين تكون البطاقة في جيبٍ والصندوق في حسابٍ آخر، ورفضُه
   * يجبر المستخدم على الكذب. والأثر حقيقيّ: حساب الصندوق تحرّر منه ما كان
   * فيه بلا أن ينقص رصيده، والحساب الدافع نقص — فالأول مدينٌ للثاني.
   */
  const settlement =
    chargeAccountId && fundAccountId && chargeAccountId !== fundAccountId && renewal.amountPaid > 0
      ? {
          debtorAccountId: fundAccountId,
          creditorAccountId: chargeAccountId,
          amount: renewal.amountPaid,
        }
      : null

  return {
    renewal,
    withdrawn,
    // لا رصيد يُمسّ حين لا حساب، أو حين لم يخرج شيء (صندوقٌ فارغٌ والتزامٌ بصفر).
    chargeAccountId: withdrawn > 0 ? chargeAccountId : null,
    settlement,
  }
}
