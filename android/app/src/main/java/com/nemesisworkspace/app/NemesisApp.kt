package com.nemesisworkspace.app

import android.app.Application
import android.content.res.Configuration

/**
 * NemesisWorkspace — point d'entrée de l'application.
 *
 * Rien à initialiser : les documents, feuilles de calcul et présentations sont
 * des fichiers de l'application, lus directement depuis ses ressources. Cette
 * classe existe pour garder une identité stable à l'application et suivre la
 * densité choisie par la personne.
 */
class NemesisApp : Application() {

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        density = newConfig.densityDpi
    }

    companion object {
        lateinit var instance: NemesisApp
            private set

        var density: Int = Configuration.DENSITY_DPI_UNDEFINED
            private set
    }
}
