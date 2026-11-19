// SignFields.kt calls String.toLowerCase(), which newer Kotlin no longer offers;
// this same-package extension takes precedence and does the same thing.
package com.diches.dichboxmobile.mv.verifiers.signVerifiers

internal fun String.toLowerCase(): String = lowercase()
