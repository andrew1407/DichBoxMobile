// android.graphics as the app's view decorators use it.
package android.graphics

object Color {
    fun parseColor(colorString: String): Int {
        val hex = colorString.removePrefix("#")
        val argb = if (hex.length == 6) "ff$hex" else hex
        return argb.toLong(16).toInt()
    }
}

object Typeface {
    const val NORMAL = 0
    const val BOLD = 1
    const val ITALIC = 2
}
