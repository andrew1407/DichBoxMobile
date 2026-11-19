// The annotations UserService.kt and BoxesService.kt are declared with.
package retrofit2.http

@Target(AnnotationTarget.FUNCTION)
annotation class POST(val value: String = "")

@Target(AnnotationTarget.VALUE_PARAMETER)
annotation class Body
