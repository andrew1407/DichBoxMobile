package androidx.core.graphics.drawable

import android.graphics.drawable.Drawable
import showcase.platform.hexColor
import showcase.platform.jsView

object DrawableCompat {
    fun setTint(drawable: Drawable, tint: Int) = jsView(drawable.handle, "tint", hexColor(tint))
}
