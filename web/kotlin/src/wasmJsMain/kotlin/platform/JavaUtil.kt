// java.util.Locale as used by UserEditFields.kt: name.lowercase(Locale.getDefault()).
package java.util

class Locale private constructor(val tag: String) {
    companion object {
        val ROOT = Locale("")
        fun getDefault(): Locale = ROOT
    }
}

fun String.lowercase(locale: Locale): String = this.lowercase()
