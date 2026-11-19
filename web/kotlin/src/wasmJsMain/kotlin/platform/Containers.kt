// JSON for the app's own UserContainer/BoxesContainer data classes, the way Gson does it:
// gsonEncode/gsonDecode are generated from the data class declarations (containerCodec task
// in build.gradle.kts); these helpers read single fields with Gson's defaults.
package showcase.platform

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlin.reflect.KClass

internal fun encodeContainer(value: Any): String = gsonEncode(value).toString()

internal fun decodeContainer(json: String, kclass: KClass<*>): Any =
    gsonDecode(Json.parseToJsonElement(json), containerKeys[kclass] ?: error("Not a container: $kclass"))

private fun field(o: JsonObject, name: String): JsonElement? = o[name]?.takeIf { it !is JsonNull }

internal fun stringOf(e: JsonElement): String = (e as? JsonPrimitive)?.contentOrNull ?: ""
internal fun intOf(e: JsonElement): Int = (e as? JsonPrimitive)?.intOrNull ?: 0
internal fun booleanOf(e: JsonElement): Boolean = (e as? JsonPrimitive)?.booleanOrNull ?: false

internal fun string(o: JsonObject, name: String): String = field(o, name)?.let(::stringOf) ?: ""
internal fun stringN(o: JsonObject, name: String): String? = field(o, name)?.let(::stringOf)
internal fun int(o: JsonObject, name: String): Int = field(o, name)?.let(::intOf) ?: 0
internal fun intN(o: JsonObject, name: String): Int? = field(o, name)?.let(::intOf)
internal fun boolean(o: JsonObject, name: String): Boolean = field(o, name)?.let(::booleanOf) ?: false
internal fun booleanN(o: JsonObject, name: String): Boolean? = field(o, name)?.let(::booleanOf)
internal fun obj(o: JsonObject, name: String, key: String): Any = gsonDecode(field(o, name) ?: JsonObject(emptyMap()), key)
internal fun objN(o: JsonObject, name: String, key: String): Any? = field(o, name)?.let { gsonDecode(it, key) }
internal fun <T> list(o: JsonObject, name: String, item: (JsonElement) -> T): List<T> = (field(o, name) as? JsonArray)?.map(item) ?: emptyList()
internal fun <T> listN(o: JsonObject, name: String, item: (JsonElement) -> T): List<T>? = (field(o, name) as? JsonArray)?.map(item)
