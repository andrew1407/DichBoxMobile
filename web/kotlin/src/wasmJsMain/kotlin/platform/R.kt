// The generated resource ids FieldsVerifier.kt refers to; the page maps them back to the
// res/drawable XML files of the same name.
package com.diches.dichboxmobile

object R {
    object drawable {
        const val sign_submit_btn_active = 1
        const val sign_submit_btn_inactive = 2
    }

    fun drawableName(id: Int): String = when (id) {
        drawable.sign_submit_btn_active -> "sign_submit_btn_active"
        drawable.sign_submit_btn_inactive -> "sign_submit_btn_inactive"
        else -> ""
    }
}
