# Le pont JavaScript est appelé par nom depuis l'interface : les noms de
# méthodes de la classe Host et ses annotations ne doivent pas changer.
-keepclassmembers class com.nemesisworkspace.app.MainActivity$Host {
    public *;
}
-keepattributes JavascriptInterface
