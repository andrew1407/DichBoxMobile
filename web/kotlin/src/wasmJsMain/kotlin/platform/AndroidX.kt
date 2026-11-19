// androidx helpers used by FieldsVerifier and SignInVerifier.
package androidx.core.widget

import android.text.Editable
import android.widget.TextView

fun TextView.addTextChangedListener(afterTextChanged: (Editable?) -> Unit) {
    textListeners.add(afterTextChanged)
}
